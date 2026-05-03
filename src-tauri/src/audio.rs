use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// Shared recording state accessible across start/stop commands.
struct RecordingState {
    is_recording: Arc<AtomicBool>,
    /// Collected samples from the recording thread
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Mutex<u32>,
    channels: Mutex<u16>,
}

// RecordingState is Send+Sync because it only uses atomic/mutex types (no cpal::Stream).
unsafe impl Send for RecordingState {}
unsafe impl Sync for RecordingState {}

static RECORDING: OnceLock<RecordingState> = OnceLock::new();

fn get_state() -> &'static RecordingState {
    RECORDING.get_or_init(|| RecordingState {
        is_recording: Arc::new(AtomicBool::new(false)),
        samples: Arc::new(Mutex::new(Vec::new())),
        sample_rate: Mutex::new(44100),
        channels: Mutex::new(1),
    })
}

const WAV_PATH: &str = "/tmp/visionpipe-recording.wav";

/// Start recording audio from the default input device.
/// Returns immediately; audio capture runs in a background thread.
pub fn start_recording() -> Result<(), String> {
    let state = get_state();

    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Already recording".into());
    }

    // Clear previous samples
    if let Ok(mut buf) = state.samples.lock() {
        buf.clear();
    }

    // Probe the device config on the main thread before spawning
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device available")?;

    eprintln!("[VisionPipe] Using input device: {:?}", device.name());

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get input config: {}", e))?;

    eprintln!("[VisionPipe] Input config: {:?}", config);

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    *state.sample_rate.lock().unwrap() = sample_rate;
    *state.channels.lock().unwrap() = channels;

    let samples_ref = state.samples.clone();
    let is_recording = state.is_recording.clone();

    is_recording.store(true, Ordering::SeqCst);

    // Spawn a dedicated thread that owns the cpal Stream (which is !Send on macOS).
    // The thread keeps the stream alive until is_recording becomes false.
    std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("[VisionPipe] No input device in recording thread");
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[VisionPipe] Config error in recording thread: {}", e);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let samples_clone = samples_ref.clone();
        let is_rec = is_recording.clone();

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if is_rec.load(Ordering::Relaxed) {
                        if let Ok(mut buf) = samples_clone.lock() {
                            buf.extend_from_slice(data);
                        }
                    }
                },
                |err| eprintln!("[VisionPipe] Audio stream error: {}", err),
                None,
            ),
            cpal::SampleFormat::I16 => {
                let sc = samples_clone;
                let ir = is_rec;
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if ir.load(Ordering::Relaxed) {
                            if let Ok(mut buf) = sc.lock() {
                                for &s in data {
                                    buf.push(s as f32 / i16::MAX as f32);
                                }
                            }
                        }
                    },
                    |err| eprintln!("[VisionPipe] Audio stream error: {}", err),
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let sc = samples_clone;
                let ir = is_rec;
                device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if ir.load(Ordering::Relaxed) {
                            if let Ok(mut buf) = sc.lock() {
                                for &s in data {
                                    buf.push((s as f32 / u16::MAX as f32) * 2.0 - 1.0);
                                }
                            }
                        }
                    },
                    |err| eprintln!("[VisionPipe] Audio stream error: {}", err),
                    None,
                )
            }
            fmt => {
                eprintln!("[VisionPipe] Unsupported sample format: {:?}", fmt);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[VisionPipe] Failed to build stream: {}", e);
                is_recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[VisionPipe] Failed to play stream: {}", e);
            is_recording.store(false, Ordering::SeqCst);
            return;
        }

        eprintln!(
            "[VisionPipe] Recording started ({}Hz, {} ch)",
            sample_rate, channels
        );

        // Keep the thread (and stream) alive until recording is stopped
        while is_recording.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // stream is dropped here, stopping audio capture
        eprintln!("[VisionPipe] Recording thread exiting");
    });

    // Brief pause to let the recording thread start
    std::thread::sleep(std::time::Duration::from_millis(100));

    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Recording failed to start (check logs)".into());
    }

    Ok(())
}

/// Stop recording, write WAV to disk, run speech recognition, return transcript.
pub fn stop_recording_and_transcribe() -> Result<String, String> {
    let state = get_state();

    if !state.is_recording.load(Ordering::SeqCst) {
        return Err("Not recording".into());
    }

    // Signal the recording thread to stop
    state.is_recording.store(false, Ordering::SeqCst);

    // Give the recording thread a moment to finish
    std::thread::sleep(std::time::Duration::from_millis(150));

    let samples_data = state
        .samples
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone();

    let sample_rate = *state.sample_rate.lock().unwrap();
    let channels = *state.channels.lock().unwrap();

    eprintln!(
        "[VisionPipe] Recording stopped. {} samples captured.",
        samples_data.len()
    );

    if samples_data.is_empty() {
        return Err("No audio captured".into());
    }

    // Convert to mono if multi-channel
    let mono: Vec<f32> = if channels > 1 {
        samples_data
            .chunks(channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples_data
    };

    // Write WAV file
    write_wav(&mono, sample_rate)?;
    eprintln!("[VisionPipe] WAV written to {}", WAV_PATH);

    // Run native macOS speech recognition (in-process via Objective-C bridge)
    let transcript = crate::speech::transcribe_file(WAV_PATH)?;
    eprintln!("[VisionPipe] Transcript: {:?}", transcript);

    // Clean up temp file
    let _ = std::fs::remove_file(WAV_PATH);

    Ok(transcript)
}

/// Write mono f32 samples as a 16-bit PCM WAV file.
fn write_wav(samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let mut file =
        std::fs::File::create(WAV_PATH).map_err(|e| format!("Failed to create WAV: {}", e))?;

    let num_samples = samples.len() as u32;
    let bits_per_sample: u16 = 16;
    let num_channels: u16 = 1;
    let byte_rate = sample_rate * (bits_per_sample as u32 / 8) * num_channels as u32;
    let block_align = num_channels * (bits_per_sample / 8);
    let data_size = num_samples * (bits_per_sample as u32 / 8);

    // RIFF header
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&(36 + data_size).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"WAVE").map_err(|e| e.to_string())?;

    // fmt chunk
    file.write_all(b"fmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?; // PCM
    file.write_all(&num_channels.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&sample_rate.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&byte_rate.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&block_align.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&bits_per_sample.to_le_bytes())
        .map_err(|e| e.to_string())?;

    // data chunk
    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|e| e.to_string())?;

    for &sample in samples {
        let clamped = sample.max(-1.0).min(1.0);
        let i16_val = (clamped * i16::MAX as f32) as i16;
        file.write_all(&i16_val.to_le_bytes())
            .map_err(|e| e.to_string())?;
    }

    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

