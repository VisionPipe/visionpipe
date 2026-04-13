use tauri::{
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

mod capture;
mod metadata;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Create system tray
            let _tray = TrayIconBuilder::new()
                .tooltip("VisionPipe")
                .on_tray_icon_event(|_tray, _event| {})
                .build(app)?;

            // Ensure window is hidden on startup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
                // Devtools disabled — opening them shifts the webview
                // and causes capture region offsets.
                // Uncomment temporarily if needed for debugging:
                // #[cfg(debug_assertions)]
                // window.open_devtools();
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![take_screenshot, capture_fullscreen, get_metadata, save_and_copy_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
