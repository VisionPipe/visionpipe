use std::sync::Mutex;
use tauri::{
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

mod audio;
mod speech;
mod credits;

use visionpipe_core::capture;
use visionpipe_core::metadata;

#[tauri::command]
async fn take_screenshot(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    capture::capture_region(x, y, width, height)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn capture_fullscreen() -> Result<String, String> {
    capture::capture_fullscreen()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_metadata() -> Result<metadata::CaptureMetadata, String> {
    Ok(metadata::collect_metadata())
}

/// Check macOS permission status for screen recording, accessibility, microphone, and speech.
#[tauri::command]
async fn check_permissions() -> Result<std::collections::HashMap<String, bool>, String> {
    use std::collections::HashMap;
    use std::process::Command;

    let mut perms = HashMap::new();

    // Screen recording: attempt a tiny screencapture
    let tmp = "/tmp/visionpipe-perm-check.png";
    let sr = Command::new("screencapture")
        .args(["-x", "-R", "0,0,1,1", tmp])
        .output()
        .map_err(|e| e.to_string())?;
    let sr_ok = sr.status.success() && std::fs::metadata(tmp).map(|m| m.len() > 0).unwrap_or(false);
    let _ = std::fs::remove_file(tmp);
    perms.insert("screen_recording".into(), sr_ok);

    // Accessibility: check via AppleScript
    let ax = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to return name of first process"])
        .output()
        .map_err(|e| e.to_string())?;
    perms.insert("accessibility".into(), ax.status.success());

    // Microphone: native check via compiled Objective-C bridge
    perms.insert("microphone".into(), speech::is_mic_authorized());

    // Speech recognition: native check
    perms.insert("speech_recognition".into(), speech::is_speech_authorized());

    Ok(perms)
}

/// Request microphone access via native API (shows system prompt from VisionPipe).
#[tauri::command]
async fn request_microphone_access() -> Result<bool, String> {
    Ok(speech::request_mic_auth())
}

/// Request speech recognition access via native API (shows system prompt from VisionPipe).
#[tauri::command]
async fn request_speech_recognition() -> Result<bool, String> {
    Ok(speech::request_speech_auth())
}

/// Open macOS System Settings to the appropriate permission pane.
#[tauri::command]
async fn open_permission_settings(permission: String) -> Result<(), String> {
    use std::process::Command;

    let url = match permission.as_str() {
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        _ => return Err(format!("Unknown permission: {}", permission)),
    };

    Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Save PNG bytes to ~/Pictures/VisionPipe/ and set clipboard to the file
/// so it can be pasted into Finder, desktop, and image-accepting apps.
#[tauri::command]
async fn save_and_copy_image(png_bytes: Vec<u8>) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    // Ensure ~/Pictures/VisionPipe/ exists
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = format!("{}/Pictures/VisionPipe", home);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Generate timestamped filename
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let filename = format!("VisionPipe_{}.png", timestamp);
    let filepath = format!("{}/{}", dir, filename);

    // Write the PNG file
    fs::write(&filepath, &png_bytes).map_err(|e| e.to_string())?;
    eprintln!("[VisionPipe] Saved {} ({} bytes)", filepath, png_bytes.len());

    // Set clipboard with both file URL (for Finder paste) and PNG data
    // (for image-accepting apps like Claude, Preview).
    // Uses JXA (JavaScript for Automation) with NSPasteboardItem to hold
    // multiple representations on a single pasteboard item.
    let jxa_script = format!(
        r#"ObjC.import('AppKit');
ObjC.import('Foundation');
var path = '{}';
var data = $.NSData.dataWithContentsOfFile(path);
var url = $.NSURL.fileURLWithPath(path);

// Create a pasteboard item with multiple representations
var item = $.NSPasteboardItem.alloc.init;
item.setDataForType(data, $.NSPasteboardTypePNG);
item.setStringForType(url.absoluteString.js, $.NSPasteboardTypeFileURL);

var pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.writeObjects($.NSArray.arrayWithObject(item));"#,
        filepath
    );

    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", &jxa_script])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[VisionPipe] JXA clipboard failed: {}", stderr);

        // Fallback: try AppleScript to at least set PNG data
        let _ = Command::new("osascript")
            .args(["-e", &format!(
                r#"set the clipboard to (read (POSIX file "{}") as «class PNGf»)"#,
                filepath
            )])
            .status();
    }

    Ok(filepath)
}

#[tauri::command]
async fn start_recording() -> Result<(), String> {
    audio::start_recording()
}

#[tauri::command]
async fn stop_recording() -> Result<String, String> {
    // Run the blocking transcription (swift subprocess) on a separate thread
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = audio::stop_recording_and_transcribe();
        let _ = tx.send(result);
    });
    rx.recv()
        .map_err(|e| format!("Channel error: {}", e))?
}

#[tauri::command]
fn get_credit_balance(state: tauri::State<Mutex<credits::CreditLedger>>) -> u64 {
    state.lock().unwrap().balance
}

#[tauri::command]
fn add_credits(amount: u64, state: tauri::State<Mutex<credits::CreditLedger>>, app: tauri::AppHandle) -> u64 {
    let mut ledger = state.lock().unwrap();
    ledger.balance += amount;
    credits::save_balance(&app, ledger.balance);
    ledger.balance
}

#[tauri::command]
fn preview_capture_cost(width: u32, height: u32, has_annotation: bool, has_voice: bool) -> credits::CreditCost {
    credits::calculate_cost(&credits::CaptureJob { width, height, has_annotation, has_voice })
}

#[tauri::command]
fn deduct_credits(
    width: u32,
    height: u32,
    has_annotation: bool,
    has_voice: bool,
    state: tauri::State<Mutex<credits::CreditLedger>>,
    app: tauri::AppHandle,
) -> Result<credits::CreditCost, String> {
    let cost = credits::calculate_cost(&credits::CaptureJob { width, height, has_annotation, has_voice });
    let mut ledger = state.lock().unwrap();
    ledger.deduct(&cost).map_err(|e| e.to_string())?;
    credits::save_balance(&app, ledger.balance);
    Ok(cost)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Mutex::new(credits::CreditLedger::new(0)))
        .setup(|app| {
            // Create system tray
            let _tray = TrayIconBuilder::new()
                .tooltip("VisionPipe")
                .on_tray_icon_event(|_tray, _event| {})
                .build(app)?;

            // Show window on startup for onboarding; frontend hides it if already completed
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(600.0, 480.0)));
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
                #[cfg(debug_assertions)]
                window.open_devtools();
            }

            // Register global shortcut
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+C", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    eprintln!("[VisionPipe] Shortcut triggered!");
                    if let Some(window) = app_handle.get_webview_window("main") {
                        // Size window to fill the screen
                        if let Ok(Some(monitor)) = window.current_monitor() {
                            let size = monitor.size();
                            let pos = monitor.position();
                            let _ = window.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(pos.x, pos.y)
                            ));
                            let _ = window.set_size(tauri::Size::Physical(
                                tauri::PhysicalSize::new(size.width, size.height)
                            ));
                            eprintln!("[VisionPipe] Window sized to {}x{}", size.width, size.height);
                        }
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.set_always_on_top(true);
                        // Simple event with no payload — frontend handles the rest
                        let handle = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            eprintln!("[VisionPipe] Emitting start-capture");
                            let _ = handle.emit("start-capture", "ready");
                        });
                    }
                }
            })?;

            // Load persisted credit balance
            {
                let balance = credits::load_balance(&app.handle());
                let state: tauri::State<Mutex<credits::CreditLedger>> = app.state();
                state.lock().unwrap().balance = balance;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_screenshot, capture_fullscreen, get_metadata, save_and_copy_image,
            check_permissions, open_permission_settings, request_microphone_access,
            request_speech_recognition, start_recording, stop_recording,
            get_credit_balance, add_credits, preview_capture_cost, deduct_credits
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
