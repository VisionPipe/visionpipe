//! Native bridge to macOS Speech framework via Objective-C FFI.
//! These functions run inside the app process, so TCC permission prompts
//! correctly show "VisionPipe" and the app appears in System Settings.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

extern "C" {
    fn speech_auth_status() -> i32;
    fn speech_request_auth() -> i32;
    fn mic_request_auth() -> i32;
    fn mic_auth_status() -> i32;
    fn speech_transcribe_file(wav_path: *const c_char, error_out: *mut *mut c_char) -> *mut c_char;
}

/// Check if speech recognition is authorized (status 3 = authorized).
pub fn is_speech_authorized() -> bool {
    unsafe { speech_auth_status() == 3 }
}

/// Outcome of a TCC authorization request — distinguishes a timeout from
/// an explicit denial. The Tauri command layer maps timeouts to an Err
/// so the frontend can surface a "we never heard back" toast and direct
/// the user to System Settings, instead of falsely reporting Denied.
#[derive(Debug, Clone, Copy)]
pub enum AuthOutcome {
    Granted,
    Denied,
    TimedOut,
}

impl AuthOutcome {
    fn from_objc(code: i32) -> Self {
        match code {
            1 => AuthOutcome::Granted,
            0 => AuthOutcome::Denied,
            _ => AuthOutcome::TimedOut, // -1 sentinel from speech_bridge.m
        }
    }
}

/// Request speech recognition authorization. Blocks the calling thread
/// until the user responds or 60 seconds elapse. Callers MUST run this
/// off the main thread (e.g. via `tauri::async_runtime::spawn_blocking`)
/// because Apple's framework dispatches the completion handler to the
/// main queue — blocking main here deadlocks until the timeout.
pub fn request_speech_auth() -> AuthOutcome {
    let result = unsafe { speech_request_auth() };
    log::info!("[VisionPipe] Speech auth request result: {}", result);
    AuthOutcome::from_objc(result)
}

/// Check if microphone is authorized.
pub fn is_mic_authorized() -> bool {
    unsafe { mic_auth_status() == 3 }
}

/// Request microphone authorization. See `request_speech_auth` for
/// threading caveats.
pub fn request_mic_auth() -> AuthOutcome {
    let result = unsafe { mic_request_auth() };
    log::info!("[VisionPipe] Mic auth request result: {}", result);
    AuthOutcome::from_objc(result)
}

/// Transcribe a WAV file using the native SFSpeechRecognizer.
pub fn transcribe_file(wav_path: &str) -> Result<String, String> {
    let c_path = CString::new(wav_path).map_err(|e| e.to_string())?;
    let mut error_ptr: *mut c_char = std::ptr::null_mut();

    let result_ptr = unsafe { speech_transcribe_file(c_path.as_ptr(), &mut error_ptr) };

    if result_ptr.is_null() {
        let error = if !error_ptr.is_null() {
            let msg = unsafe { CStr::from_ptr(error_ptr) }
                .to_string_lossy()
                .into_owned();
            unsafe { libc::free(error_ptr as *mut _) };
            msg
        } else {
            "Unknown transcription error".into()
        };
        return Err(error);
    }

    let text = unsafe { CStr::from_ptr(result_ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { libc::free(result_ptr as *mut _) };

    Ok(text)
}
