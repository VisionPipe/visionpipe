use serde::Serialize;

#[cfg(target_os = "macos")]
use std::ffi::c_void;
#[cfg(target_os = "macos")]
use std::ptr;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

// AEDesc — Apple Event descriptor used to identify a target app for
// AEDeterminePermissionToAutomateTarget. The struct layout matches Apple's
// AppleEvents.framework definition.
#[cfg(target_os = "macos")]
#[repr(C)]
struct AEDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn AECreateDesc(
        type_code: u32,
        data_ptr: *const c_void,
        data_size: isize,
        result: *mut AEDesc,
    ) -> i16;

    fn AEDisposeDesc(desc: *mut AEDesc) -> i16;

    fn AEDeterminePermissionToAutomateTarget(
        target: *const AEDesc,
        the_aevt_class: u32,
        the_aevt_id: u32,
        ask_user_if_needed: u8,
    ) -> i32;
}

// FourCharCode constants used by the Apple Events APIs (big-endian ASCII).
#[cfg(target_os = "macos")]
const TYPE_APPLICATION_BUNDLE_ID: u32 = u32::from_be_bytes(*b"bnid");
#[cfg(target_os = "macos")]
const TYPE_WILD_CARD: u32 = u32::from_be_bytes(*b"****");

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub screen_recording: bool,
    pub system_events: bool,
    pub accessibility: bool,
}

fn check_screen_recording() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        CGPreflightScreenCaptureAccess()
    }

    #[cfg(not(target_os = "macos"))]
    true
}

fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        AXIsProcessTrusted()
    }

    #[cfg(not(target_os = "macos"))]
    true
}

/// Check whether VisionPipe has permission to send Apple Events to System
/// Events. We use `osascript` rather than the Carbon
/// AEDeterminePermissionToAutomateTarget API because the Carbon API returns
/// procNotFound (-600) when System Events isn't running — and the official
/// "launch it first via open -jgb" workaround is racy.
///
/// `osascript -e 'tell application "System Events" to ...'` causes
/// AppleScript itself to launch System Events synchronously and then send
/// the event. If permission is granted, we get a count back. If denied or
/// not-yet-decided, osascript fails (and on first run, may show the system
/// prompt — that's why the frontend shows the welcome card before calling
/// check_permissions).
fn check_system_events() -> bool {
    #[cfg(target_os = "macos")]
    {
        let result = std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"System Events\" to return count of processes",
            ])
            .output();

        match result {
            Ok(o) => {
                let granted = o.status.success() && !o.stdout.is_empty();
                eprintln!(
                    "[VisionPipe] osascript SystemEvents: exit={} stdout={:?} stderr={:?} -> granted={}",
                    o.status.code().unwrap_or(-1),
                    String::from_utf8_lossy(&o.stdout).trim(),
                    String::from_utf8_lossy(&o.stderr).trim(),
                    granted
                );
                granted
            }
            Err(e) => {
                eprintln!("[VisionPipe] osascript spawn error: {}", e);
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    true
}

#[tauri::command]
pub fn check_permissions() -> PermissionStatus {
    // Debug override: when VISIONPIPE_FORCE_ONBOARDING is set, force both
    // permissions to false so the onboarding UI is visible during dev.
    if std::env::var("VISIONPIPE_FORCE_ONBOARDING").is_ok() {
        return PermissionStatus {
            screen_recording: false,
            system_events: false,
            accessibility: false,
        };
    }

    PermissionStatus {
        screen_recording: check_screen_recording(),
        system_events: check_system_events(),
        accessibility: check_accessibility(),
    }
}

/// Open the relevant pane of System Settings via macOS's x-apple URL scheme.
#[tauri::command]
pub fn open_settings_pane(pane: String) -> Result<(), String> {
    let url = match pane.as_str() {
        "screen_recording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        "automation" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        _ => return Err(format!("Unknown settings pane: {}", pane)),
    };

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
