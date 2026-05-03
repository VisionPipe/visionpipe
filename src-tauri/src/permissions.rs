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
/// Events, WITHOUT prompting the user. Returns true only if a prior grant
/// exists; "not yet decided" and "denied" both return false.
///
/// AEDeterminePermissionToAutomateTarget returns procNotFound (-600) if the
/// target app isn't running — and System Events is a launch-on-demand
/// daemon. So we launch it first via `open -b` (which doesn't require Apple
/// Events permission) before checking.
fn check_system_events() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Ensure System Events is running. `open -jgb` = launch by bundle ID,
        // hidden, don't activate. Returns immediately even if already running.
        let _ = std::process::Command::new("open")
            .args(["-jgb", "com.apple.systemevents"])
            .output();

        // Give launchd a moment to attach before we query.
        std::thread::sleep(std::time::Duration::from_millis(80));

        let bundle_id = b"com.apple.systemevents";
        let mut desc = AEDesc {
            descriptor_type: 0,
            data_handle: ptr::null_mut(),
        };

        let create_err = unsafe {
            AECreateDesc(
                TYPE_APPLICATION_BUNDLE_ID,
                bundle_id.as_ptr() as *const c_void,
                bundle_id.len() as isize,
                &mut desc,
            )
        };
        if create_err != 0 {
            eprintln!("[VisionPipe] AECreateDesc failed: {}", create_err);
            return false;
        }

        let status = unsafe {
            AEDeterminePermissionToAutomateTarget(
                &desc,
                TYPE_WILD_CARD,
                TYPE_WILD_CARD,
                0, // askUserIfNeeded = false (no prompt)
            )
        };

        unsafe {
            AEDisposeDesc(&mut desc);
        }

        eprintln!(
            "[VisionPipe] AEDeterminePermissionToAutomateTarget(System Events) status: {}",
            status
        );

        // 0 = noErr (granted). Anything else (-1743 denied, -1744 not yet
        // determined, -600 procNotFound) is treated as not granted.
        status == 0
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
