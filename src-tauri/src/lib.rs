use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};

mod audio;
mod capture;
mod hotkey_config;
mod install_token;
mod metadata;
mod permissions;
mod session;
mod speech;

/// Shared state mapping tray-menu ID `recent_<N>` → file path on disk.
/// Updated whenever we rebuild the tray menu (on launch + after each
/// capture). Lock held briefly during click dispatch.
struct RecentCapturesState(Mutex<Vec<String>>);

/// List the up-to-5 most recent .png files in ~/Pictures/VisionPipe/
/// sorted by mtime descending. Returns (display_label, full_path) pairs.
/// `display_label` is a human-readable timestamp like "2:42 PM (region)".
fn list_recent_captures() -> Vec<(String, String)> {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return Vec::new(),
    };
    let dir = format!("{}/Pictures/VisionPipe", home);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("png") {
                return None;
            }
            let mtime = e.metadata().ok().and_then(|m| m.modified().ok())?;
            Some((mtime, p))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(5);

    files
        .into_iter()
        .map(|(mtime, path)| {
            let label = format_capture_label(&path, mtime);
            (label, path.to_string_lossy().to_string())
        })
        .collect()
}

/// Format a capture filename + mtime into a friendly menu label.
/// Filenames look like `VisionPipe_2026-05-03_09-42-13.png`.
fn format_capture_label(path: &std::path::Path, mtime: std::time::SystemTime) -> String {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("capture");
    // Use the local time of last modification as the display.
    let dt: chrono::DateTime<chrono::Local> = mtime.into();
    let now = chrono::Local::now();
    let same_day = dt.date_naive() == now.date_naive();
    let time_part = dt.format("%-I:%M %p").to_string();
    if same_day {
        format!("Today at {}", time_part)
    } else {
        format!("{} at {}", dt.format("%b %-d").to_string(), time_part)
    }
    .clone()
    + &format!(" — {}", name.trim_end_matches(".png").trim_start_matches("VisionPipe_"))
}

/// Build the tray menu from the current recent-captures list.
fn build_tray_menu(
    app: &AppHandle,
    recents: &[(String, String)],
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    if recents.is_empty() {
        let label = MenuItem::with_id(
            app,
            "no_recents",
            "No recent captures yet",
            false,
            None::<&str>,
        )?;
        items.push(Box::new(label));
    } else {
        let header = MenuItem::with_id(app, "recents_header", "Recent captures", false, None::<&str>)?;
        items.push(Box::new(header));
        for (i, (label, _path)) in recents.iter().enumerate() {
            let id = format!("recent_{}", i);
            let mi = MenuItem::with_id(app, &id, format!("  {}", label), true, None::<&str>)?;
            items.push(Box::new(mi));
        }
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    items.push(Box::new(MenuItem::with_id(
        app, "take_capture", "Take Capture (⌘⇧C)", true, None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app, "take_scrolling_capture", "Take Scrolling Capture (⌘⇧S)", true, None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app, "open_captures_folder", "Open Captures Folder…", true, None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    items.push(Box::new(MenuItem::with_id(
        app, "show_onboarding", "Show Onboarding…", true, None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(PredefinedMenuItem::quit(app, Some("Quit Vision|Pipe"))?));

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &item_refs)
}

/// Rebuild the tray menu from the current filesystem state and replace
/// the tray's menu in-place. Also updates the shared `RecentCapturesState`
/// so click dispatch uses the same path list the menu was built from.
fn refresh_tray_menu(app: &AppHandle) {
    let recents = list_recent_captures();

    if let Some(state) = app.try_state::<RecentCapturesState>() {
        if let Ok(mut paths) = state.0.lock() {
            *paths = recents.iter().map(|(_, p)| p.clone()).collect();
        }
    }

    if let Ok(menu) = build_tray_menu(app, &recents) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

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
async fn save_and_copy_image(app: AppHandle, png_bytes: Vec<u8>) -> Result<String, String> {
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

    // Refresh the tray menu so the new capture appears in "Recent captures".
    refresh_tray_menu(&app);

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
            let _ = show_onboarding; // kept for type elaboration; real menu is built below

            // Initial tray-menu build with current filesystem state, plus
            // shared mutex of recent paths so click dispatch can resolve
            // `recent_<N>` IDs back to the actual file path.
            app.manage(RecentCapturesState(Mutex::new(Vec::new())));
            let initial_recents = list_recent_captures();
            if let Some(state) = app.try_state::<RecentCapturesState>() {
                if let Ok(mut paths) = state.0.lock() {
                    *paths = initial_recents.iter().map(|(_, p)| p.clone()).collect();
                }
            }
            let menu = build_tray_menu(app.handle(), &initial_recents)?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("VisionPipe")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "show_onboarding" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("show-onboarding", ());
                            }
                        }
                        "take_capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("start-capture", "tray");
                            }
                        }
                        "take_scrolling_capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("start-scroll-capture", "tray");
                            }
                        }
                        "open_captures_folder" => {
                            if let Ok(home) = std::env::var("HOME") {
                                let dir = format!("{}/Pictures/VisionPipe", home);
                                let _ = std::fs::create_dir_all(&dir);
                                let _ = std::process::Command::new("open").arg(&dir).status();
                            }
                        }
                        _ if id.starts_with("recent_") => {
                            // recent_<N>: open Nth file from RecentCapturesState
                            if let Some(rest) = id.strip_prefix("recent_") {
                                if let Ok(idx) = rest.parse::<usize>() {
                                    if let Some(state) = app.try_state::<RecentCapturesState>() {
                                        if let Ok(paths) = state.0.lock() {
                                            if let Some(path) = paths.get(idx) {
                                                let _ = std::process::Command::new("open")
                                                    .arg(path)
                                                    .status();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
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
