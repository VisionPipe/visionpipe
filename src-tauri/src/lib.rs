use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

mod audio;
mod capture;
mod hotkey_config;
mod install_token;
mod metadata;
mod permissions;
mod session;
mod speech;

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

/// Capture a scrolling screenshot of the same region across `num_scrolls`
/// frames, sending Page Down between each, then stitch them vertically
/// into a single PNG. Returns a base64 data URI of the stitched image.
/// Defaults to 5 frames if `num_scrolls` is 0 or 1.
#[tauri::command]
async fn take_scrolling_screenshot(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    num_scrolls: u32,
) -> Result<String, String> {
    let n = if num_scrolls < 2 { 5 } else { num_scrolls };
    capture::capture_scrolling_region(x, y, width, height, n)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_metadata() -> Result<metadata::CaptureMetadata, String> {
    Ok(metadata::collect_metadata())
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
async fn create_session_folder(session_id: String) -> Result<String, String> {
    session::create_session_folder(&session_id)
}

#[tauri::command]
async fn write_session_file(folder: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    session::write_session_file(&folder, &filename, bytes)
}

#[tauri::command]
async fn move_to_deleted(folder: String, filename: String) -> Result<(), String> {
    session::move_to_deleted(&folder, &filename)
}

#[tauri::command]
async fn save_install_token(token: String) -> Result<(), String> {
    install_token::save_token(&token)
}

#[tauri::command]
async fn load_install_token() -> Result<Option<String>, String> {
    install_token::load_token()
}

#[tauri::command]
async fn load_hotkey_config() -> hotkey_config::HotkeyConfig {
    hotkey_config::load()
}

#[tauri::command]
async fn save_hotkey_config(cfg: hotkey_config::HotkeyConfig) -> Result<(), String> {
    hotkey_config::save(&cfg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // System tray with menu (Show Onboarding, Quit)
            let show_onboarding = MenuItem::with_id(
                app,
                "show_onboarding",
                "Show Onboarding…",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit VisionPipe"))?;
            let menu = Menu::with_items(app, &[&show_onboarding, &separator, &quit])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("VisionPipe")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "show_onboarding" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("show-onboarding", ());
                        }
                    }
                })
                .build(app)?;

            // Ensure window is hidden on startup. The frontend's mount-time
            // useEffect will resize and show it for the welcome card.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            // Register global shortcuts
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

            // Cmd+Shift+O — re-open the onboarding window (debug/manual access)
            let onboarding_handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+O", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    eprintln!("[VisionPipe] Show-onboarding shortcut triggered");
                    if let Some(window) = onboarding_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("show-onboarding", ());
                    }
                }
            })?;

            // Configurable global capture shortcut (default Cmd+Shift+C)
            let cfg = hotkey_config::load();
            let global_combo = cfg.take_next_screenshot.clone();
            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(global_combo.as_str(), move |_app, _shortcut, event| {
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

            // Cmd+Shift+S — start a SCROLLING capture: same selection
            // overlay, but on confirm the frontend calls
            // `take_scrolling_screenshot` instead of `take_screenshot`.
            let scroll_handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+S", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    eprintln!("[VisionPipe] Scroll-capture shortcut triggered");
                    if let Some(window) = scroll_handle.get_webview_window("main") {
                        if let Ok(Some(monitor)) = window.current_monitor() {
                            let size = monitor.size();
                            let pos = monitor.position();
                            let _ = window.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(pos.x, pos.y)
                            ));
                            let _ = window.set_size(tauri::Size::Physical(
                                tauri::PhysicalSize::new(size.width, size.height)
                            ));
                        }
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.set_always_on_top(true);
                        let handle = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            eprintln!("[VisionPipe] Emitting start-scroll-capture");
                            let _ = handle.emit("start-scroll-capture", "ready");
                        });
                    }
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_screenshot,
            take_scrolling_screenshot,
            capture_fullscreen,
            get_metadata,
            save_and_copy_image,
            permissions::check_permissions,
            permissions::open_settings_pane,
            request_microphone_access,
            request_speech_recognition,
            start_recording,
            stop_recording,
            create_session_folder,
            write_session_file,
            move_to_deleted,
            save_install_token,
            load_install_token,
            load_hotkey_config,
            save_hotkey_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
