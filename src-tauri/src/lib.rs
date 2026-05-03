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

/// Stashed metadata captured at hotkey-press time (BEFORE Vision|Pipe
/// steals focus). The frontend's `get_metadata` Tauri command reads + takes
/// from this; if empty, falls back to live collection (which would return
/// `app: "visionpipe"` since by then VP is frontmost). One-shot per
/// hotkey press — consumed by the next `get_metadata` call.
struct StashedMetadata(Mutex<Option<metadata::CaptureMetadata>>);

/// Stash the current frontmost-app metadata. Called from every capture
/// trigger (Cmd+Shift+C, Cmd+Shift+S, tray "Take Capture", tray "Take
/// Scrolling Capture") BEFORE any window operations. The collection is
/// fast (~5-30ms of osascript + system_profiler calls).
fn stash_current_metadata(app: &AppHandle) {
    let snapshot = metadata::collect_metadata();
    if let Some(state) = app.try_state::<StashedMetadata>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(snapshot);
        }
    }
}

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
    items.push(Box::new(MenuItem::with_id(
        app, "reveal_logs", "Reveal Logs in Finder…", true, None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app, "save_diagnostic_bundle", "Save Diagnostic Bundle…", true, None::<&str>,
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
async fn get_metadata(state: tauri::State<'_, StashedMetadata>) -> Result<metadata::CaptureMetadata, String> {
    // Take (consume) the stashed metadata if present so the next capture
    // gets a fresh snapshot. If nothing is stashed (e.g. capture flow
    // wasn't triggered through one of our handlers), fall back to live
    // collection — which will return Vision|Pipe as the active app since
    // VP is now frontmost. That's the bug we were trying to fix; the
    // stash is the primary path.
    let stashed = state.0.lock().ok().and_then(|mut s| s.take());
    Ok(stashed.unwrap_or_else(metadata::collect_metadata))
}

/// Hide Vision|Pipe (so macOS auto-restores focus to the previously
/// frontmost app), wait briefly for that focus shift, then capture the
/// frontmost-app metadata into the stash. Used by the in-app
/// "+ Take next screenshot" path: when the user clicks the button,
/// VP is currently frontmost, so we need to step out of the way first.
/// The frontend awaits this, then proceeds with the resize + selection
/// overlay. ~250ms latency is imperceptible.
#[tauri::command]
async fn prepare_in_app_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    // Give macOS a moment to refocus the previous app.
    std::thread::sleep(std::time::Duration::from_millis(250));
    stash_current_metadata(&app);
    Ok(())
}

/// Write the markdown body to `<folder>/transcript.md` AND copy that
/// file's path onto the macOS NSPasteboard as BOTH a string (the body
/// text, for paste-into-text-editor) AND a file URL (for paste-into-Finder
/// or drag-into-Claude-Code-as-file). Mirrors the dual-representation
/// pattern in `save_and_copy_image`. Returns the absolute path to the
/// written transcript.md.
#[tauri::command]
async fn save_and_copy_markdown(folder: String, markdown: String) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    let path = std::path::PathBuf::from(&folder).join("transcript.md");
    fs::write(&path, &markdown).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    let path_str = path.to_string_lossy().to_string();

    // Build a JXA script that writes a single NSPasteboardItem with both
    // representations. Inline the markdown body as a JS-escaped string
    // (newlines + double-quotes need escaping). The file URL representation
    // points at the just-written transcript.md so paste-into-Finder yields
    // the file (not a copy of the text).
    let escaped_body = markdown
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    let escaped_path = path_str.replace('\\', "\\\\").replace('"', "\\\"");

    let jxa_script = format!(
        r#"ObjC.import('AppKit');
ObjC.import('Foundation');
var path = "{}";
var body = "{}";
var url = $.NSURL.fileURLWithPath(path);

var item = $.NSPasteboardItem.alloc.init;
item.setStringForType(body, $.NSPasteboardTypeString);
item.setStringForType(url.absoluteString.js, $.NSPasteboardTypeFileURL);

var pb = $.NSPasteboard.generalPasteboard;
pb.clearContents;
pb.writeObjects($.NSArray.arrayWithObject(item));"#,
        escaped_path, escaped_body
    );

    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", &jxa_script])
        .output()
        .map_err(|e| format!("osascript spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[VisionPipe] save_and_copy_markdown JXA failed: {}", stderr);
        // Fallback: at least put the text on the clipboard via pbcopy so
        // Copy & Send isn't completely broken if NSPasteboard fails.
        let _ = Command::new("sh")
            .arg("-c")
            .arg(format!("printf '%s' \"$1\" | pbcopy", ).as_str())
            .arg("_")
            .arg(&markdown)
            .status();
        return Err(format!("clipboard write failed: {}", stderr));
    }

    Ok(path_str)
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

/// Reveal the active log file in Finder. The Tauri log plugin writes to
/// `~/Library/Logs/com.visionpipe.desktop/visionpipe.log` with daily rotation.
#[tauri::command]
fn reveal_logs_in_finder() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let log_dir = format!("{}/Library/Logs/com.visionpipe.desktop", home);
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&log_dir)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Bundle the current logs + version + macOS system info into a zip in
/// ~/Downloads, then reveal it in Finder. Nothing leaves the user's Mac
/// — the zip is purely for them to drag into a chat or email when they
/// want to share diagnostic info.
#[tauri::command]
fn save_diagnostic_bundle() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let zip_basename = format!("visionpipe-diagnostic-{}", timestamp);
    let zip_path = format!("{}/Downloads/{}.zip", home, zip_basename);

    // Build the bundle in a /tmp staging dir so the zip's internal paths
    // are clean (just `version.txt`, `system.txt`, `logs/...`).
    let staging = format!("/tmp/{}", zip_basename);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    // Copy log directory if it exists.
    let log_dir = format!("{}/Library/Logs/com.visionpipe.desktop", home);
    if std::fs::metadata(&log_dir).is_ok() {
        let _ = std::process::Command::new("cp")
            .args(["-R", &log_dir, &format!("{}/logs", staging)])
            .status();
    }

    // version.txt
    let version_txt = format!(
        "Vision|Pipe v{}\nbuilt: {}\n",
        env!("CARGO_PKG_VERSION"),
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S %Z"),
    );
    let _ = std::fs::write(format!("{}/version.txt", staging), version_txt);

    // system.txt
    let sw_vers = std::process::Command::new("sw_vers")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let model = std::process::Command::new("sysctl")
        .args(["-n", "hw.model"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let cpu = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let system_txt = format!(
        "=== sw_vers ===\n{}\n=== Model ===\n{}\n=== CPU ===\n{}\n",
        sw_vers, model, cpu
    );
    let _ = std::fs::write(format!("{}/system.txt", staging), system_txt);

    // Zip up the staging dir (cd into /tmp so zip paths are relative).
    let status = std::process::Command::new("zip")
        .current_dir("/tmp")
        .args(["-rq", &zip_path, &zip_basename])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("zip command failed".into());
    }

    // Cleanup staging.
    let _ = std::fs::remove_dir_all(&staging);

    // Reveal the zip in Finder so the user can drag it into a chat.
    let _ = std::process::Command::new("open")
        .args(["-R", &zip_path])
        .status();

    log::info!("Diagnostic bundle saved to {}", zip_path);
    Ok(zip_path)
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
    // Default log level: info. Override with VISIONPIPE_LOG_LEVEL=debug
    // for verbose dev / diagnostic output. The `log` plugin writes to:
    //   - stdout (visible in Console.app via `log show --process visionpipe`)
    //   - file: ~/Library/Logs/com.visionpipe.desktop/visionpipe.log (rotated daily)
    //   - webview: forwards Rust log lines into JS console (ignored in prod webview but visible during dev)
    let log_level = match std::env::var("VISIONPIPE_LOG_LEVEL").ok().as_deref() {
        Some("trace") => log::LevelFilter::Trace,
        Some("debug") => log::LevelFilter::Debug,
        Some("warn") => log::LevelFilter::Warn,
        Some("error") => log::LevelFilter::Error,
        _ => log::LevelFilter::Info,
    };
    let log_plugin = tauri_plugin_log::Builder::default()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("visionpipe".to_string()),
            }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
        ])
        .level(log_level)
        .max_file_size(5_000_000) // 5 MB rotation
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .build();

    tauri::Builder::default()
        .plugin(log_plugin)
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
            // Stashed-metadata slot. Populated by every capture-trigger
            // path (hotkey, tray, in-app "+") BEFORE VP takes focus.
            // Drained by the next get_metadata invocation.
            app.manage(StashedMetadata(Mutex::new(None)));
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
                            // Capture metadata BEFORE Vision|Pipe steals focus from the tray dismiss.
                            // The tray menu was open over the user's previous app; closing it
                            // restores focus there. By the time get_metadata runs in JS, VP
                            // would be frontmost and would self-report as the active app.
                            stash_current_metadata(app);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("start-capture", "tray");
                            }
                        }
                        "take_scrolling_capture" => {
                            stash_current_metadata(app);
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
                        "reveal_logs" => {
                            let _ = reveal_logs_in_finder();
                        }
                        "save_diagnostic_bundle" => {
                            match save_diagnostic_bundle() {
                                Ok(path) => log::info!("Diagnostic bundle: {}", path),
                                Err(e) => log::error!("Diagnostic bundle failed: {}", e),
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
                    // CRITICAL: capture metadata BEFORE we show + focus the
                    // window. Once VP has focus, `metadata::collect_metadata()`
                    // would report VP itself as the active app — yielding the
                    // "App: visionpipe" garbage in the markdown output.
                    stash_current_metadata(&app_handle);
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
                    // Same as the regular hotkey: capture metadata before
                    // Vision|Pipe steals focus.
                    stash_current_metadata(&scroll_handle);
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
            prepare_in_app_capture,
            save_and_copy_image,
            save_and_copy_markdown,
            permissions::check_permissions,
            permissions::open_settings_pane,
            reveal_logs_in_finder,
            save_diagnostic_bundle,
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
