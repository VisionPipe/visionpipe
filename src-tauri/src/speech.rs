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

/// Request speech recognition authorization. Blocks until user responds.
pub fn request_speech_auth() -> bool {
    let result = unsafe { speech_request_auth() };
    eprintln!("[VisionPipe] Speech auth request result: {}", result);
    result == 1
}

/// Check if microphone is authorized.
pub fn is_mic_authorized() -> bool {
    unsafe { mic_auth_status() == 3 }
}

/// Request microphone authorization. Blocks until user responds.
pub fn request_mic_auth() -> bool {
    let result = unsafe { mic_request_auth() };
    eprintln!("[VisionPipe] Mic auth request result: {}", result);
    result == 1
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
