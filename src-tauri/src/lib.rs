use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

mod audio;
mod capture;
mod hotkey_config;
mod install_token;
mod metadata;
mod permissions;
mod session;
mod speech;
mod credits;

/// File the credit balance is persisted to via tauri-plugin-store.
const CREDIT_STORE_FILE: &str = "visionpipe.json";
/// Key inside the store JSON.
const CREDIT_BALANCE_KEY: &str = "credit_balance";

/// Default balance for fresh installs. 1,000 credits = $10.00 of capture
/// budget (1 credit per screenshot + 10 s-free audio tier). Per the
/// 2026-05-06 product call: until the Buy Credits backend ships,
/// shipping with 0 credits walls every new user behind devtools console
/// gymnastics. 1000 is enough for first-day exploration without giving
/// away the farm.
const DEFAULT_CREDIT_BALANCE: u64 = 1000;

/// Read the persisted balance, defaulting to DEFAULT_CREDIT_BALANCE for
/// fresh installs (no store file or no credit_balance key).
fn load_balance(app: &AppHandle) -> u64 {
    app.store(CREDIT_STORE_FILE)
        .ok()
        .and_then(|s| s.get(CREDIT_BALANCE_KEY))
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_CREDIT_BALANCE)
}

/// Persist the balance to the store. Best-effort; logs errors.
fn save_balance(app: &AppHandle, balance: u64) -> Result<(), String> {
    let store = app.store(CREDIT_STORE_FILE).map_err(|e| e.to_string())?;
    store.set(CREDIT_BALANCE_KEY, serde_json::Value::from(balance));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// (Re-)register all global keyboard shortcuts (Cmd+Shift+O for
/// onboarding, the configurable capture combo, Cmd+Shift+S for
/// scrolling capture). Reads the latest config from disk on each
/// call, so changing the capture combo via the Settings panel and
/// then calling `resume_global_shortcuts` makes the new combo live
/// without an app restart.
///
/// Called from `setup()` on launch and from `resume_global_shortcuts`
/// after a Settings-panel rebind.
///
/// Each registration is best-effort: if a particular hotkey is already
/// claimed by another app (or wasn't fully released by a prior
/// unregister_all), we log + continue so the OTHER shortcuts still get
/// registered. Pre-v0.9.5 a single failure aborted the whole function,
/// leaving the app with NO global hotkeys until restart — surfaced in
/// the user's diagnostic logs as the "RegisterEventHotKey failed for
/// KeyO" warning that broke Cmd+Shift+C until they relaunched.
fn register_global_shortcuts(app: &AppHandle) -> Result<(), String> {
    // Defensive: clear any lingering registrations before re-registering.
    // setup() calls this on a fresh app where unregister_all is a no-op;
    // resume_global_shortcuts calls it after pause_global_shortcuts already
    // unregistered, but a second unregister_all is harmless and protects
    // against a partial pause leaving ghost OS-level state.
    let _ = app.global_shortcut().unregister_all();

    // Cmd+Shift+O — re-open the onboarding window (debug/manual access).
    let onboarding_handle = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(
        "CmdOrCtrl+Shift+O",
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                log::info!("[VisionPipe] Show-onboarding shortcut triggered");
                if let Some(window) = onboarding_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("show-onboarding", ());
                }
            }
        },
    ) {
        log::warn!("[VisionPipe] Failed to register Cmd+Shift+O onboarding shortcut: {}", e);
    }

    // Configurable global capture shortcut (default Cmd+Shift+C).
    let cfg = hotkey_config::load();
    let global_combo = cfg.take_next_screenshot.clone();
    let app_handle = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(
        global_combo.as_str(),
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                log::info!("[VisionPipe] Capture shortcut triggered");
                stash_current_metadata(&app_handle);
                if let Some(window) = app_handle.get_webview_window("main") {
                    if let Ok(Some(monitor)) = window.current_monitor() {
                        let size = monitor.size();
                        let pos = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(pos.x, pos.y),
                        ));
                        let _ = window.set_size(tauri::Size::Physical(
                            tauri::PhysicalSize::new(size.width, size.height),
                        ));
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.set_always_on_top(true);
                    let handle = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        let _ = handle.emit("start-capture", "ready");
                    });
                }
            }
        },
    ) {
        log::warn!("[VisionPipe] Failed to register capture shortcut '{}': {}", global_combo, e);
    }

    // Cmd+Shift+S — scrolling capture.
    let scroll_handle = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(
        "CmdOrCtrl+Shift+S",
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                log::info!("[VisionPipe] Scroll-capture shortcut triggered");
                stash_current_metadata(&scroll_handle);
                if let Some(window) = scroll_handle.get_webview_window("main") {
                    if let Ok(Some(monitor)) = window.current_monitor() {
                        let size = monitor.size();
                        let pos = monitor.position();
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(pos.x, pos.y),
                        ));
                        let _ = window.set_size(tauri::Size::Physical(
                            tauri::PhysicalSize::new(size.width, size.height),
                        ));
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.set_always_on_top(true);
                    let handle = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        let _ = handle.emit("start-scroll-capture", "ready");
                    });
                }
            }
        },
    ) {
        log::warn!("[VisionPipe] Failed to register Cmd+Shift+S scrolling-capture shortcut: {}", e);
    }

    Ok(())
}

/// Shared state mapping tray-menu ID `session_<N>` → session folder path on
/// disk. Updated whenever we rebuild the tray menu (on launch + after each
/// session change). Lock held briefly during click dispatch. Renamed from
/// RecentCapturesState (which held PNG paths) so the tray now shows recent
/// SESSIONS (bundles) instead of individual screenshots — matches the
/// in-app History view.
struct RecentSessionsState(Mutex<Vec<String>>);

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

/// Summary of a single VisionPipe session, used by both the tray menu
/// and the in-app History Hub. Built lazily from the session folder
/// contents (transcript.json if present; otherwise filesystem-derived).
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub folder: String,
    /// ISO-8601 UTC, fallback to folder mtime if transcript.json is missing.
    pub created_at: String,
    /// Friendly label like "Today at 9:42 AM" — used in tray menus.
    pub label: String,
    pub screenshot_count: usize,
    /// First non-empty caption from the session, if any. Used as the
    /// row's primary identifying text in the history view.
    pub first_caption: Option<String>,
    /// First ~120 chars of the first non-empty transcriptSegment.
    /// Used as a row preview. None if no transcripts.
    pub transcript_snippet: Option<String>,
    /// Absolute paths to the first 3 .png files in the folder, used
    /// for thumbnail icons in the history row.
    pub thumbnail_paths: Vec<String>,
    /// Path to transcript.md if it exists (i.e. user has done Copy & Send
    /// on this session at least once). Drag-source for history rows.
    pub transcript_md_path: Option<String>,
}

/// Read all `session-*` directories under ~/Pictures/VisionPipe/, parse
/// metadata from each, and return up to `limit` sessions sorted by
/// folder mtime descending (most recent first).
fn list_recent_sessions(limit: usize) -> Vec<SessionSummary> {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return Vec::new(),
    };
    let dir = format!("{}/Pictures/VisionPipe", home);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut folders: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() {
                return None;
            }
            let name = p.file_name()?.to_str()?.to_string();
            if !name.starts_with("session-") {
                return None;
            }
            let mtime = e.metadata().ok().and_then(|m| m.modified().ok())?;
            Some((mtime, p))
        })
        .collect();
    folders.sort_by(|a, b| b.0.cmp(&a.0));
    folders.truncate(limit);

    folders
        .into_iter()
        .map(|(mtime, folder)| build_session_summary(&folder, mtime))
        .collect()
}

fn build_session_summary(folder: &std::path::Path, mtime: std::time::SystemTime) -> SessionSummary {
    let folder_str = folder.to_string_lossy().to_string();
    let id = folder.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("session")
        .to_string();

    // Try transcript.json first for accurate metadata.
    let transcript_json = folder.join("transcript.json");
    let parsed: Option<serde_json::Value> = std::fs::read_to_string(&transcript_json)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let dt: chrono::DateTime<chrono::Local> = mtime.into();
    let now = chrono::Local::now();
    let same_day = dt.date_naive() == now.date_naive();
    let time_part = dt.format("%-I:%M %p").to_string();
    let label = if same_day {
        format!("Today at {}", time_part)
    } else {
        format!("{} at {}", dt.format("%b %-d").to_string(), time_part)
    };

    let mut screenshot_count = 0usize;
    let mut first_caption: Option<String> = None;
    let mut transcript_snippet: Option<String> = None;
    let mut created_at = chrono::DateTime::<chrono::Utc>::from(mtime).to_rfc3339();

    if let Some(p) = &parsed {
        if let Some(s) = p.get("createdAt").and_then(|v| v.as_str()) {
            created_at = s.to_string();
        }
        if let Some(arr) = p.get("screenshots").and_then(|v| v.as_array()) {
            screenshot_count = arr.len();
            for s in arr {
                if first_caption.is_none() {
                    if let Some(c) = s.get("caption").and_then(|v| v.as_str()) {
                        if !c.is_empty() {
                            first_caption = Some(c.to_string());
                        }
                    }
                }
                if transcript_snippet.is_none() {
                    if let Some(t) = s.get("transcriptSegment").and_then(|v| v.as_str()) {
                        if !t.is_empty() {
                            let trimmed: String = t.chars().take(120).collect();
                            transcript_snippet = Some(trimmed);
                        }
                    }
                }
                if first_caption.is_some() && transcript_snippet.is_some() {
                    break;
                }
            }
        }
    }

    // Thumbnails: first 3 PNGs in the folder, sorted by name (which
    // mirrors capture order since canonicalNames start with seq).
    let mut pngs: Vec<std::path::PathBuf> = std::fs::read_dir(folder)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("png"))
                .collect()
        })
        .unwrap_or_default();
    pngs.sort();
    let thumbnail_paths: Vec<String> = pngs
        .into_iter()
        .take(3)
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    // If no transcript.json, count screenshots from PNG files.
    if parsed.is_none() {
        screenshot_count = thumbnail_paths.len(); // approximate
    }

    // The session may contain a descriptive bundle filename
    // (`VisionPipe-<date>-<count>shots-<topic>.md`, generated by the frontend
    // via `generateBundleName`) OR the legacy `transcript.md` name from
    // sessions sent before the rename. Prefer the descriptive name; fall
    // back to `transcript.md` for backwards compatibility. If multiple
    // VisionPipe-*.md files exist in the folder (e.g. user sent the bundle
    // multiple times after edits), pick the most recently modified one.
    let transcript_md_path = std::fs::read_dir(folder)
        .ok()
        .and_then(|rd| {
            let mut candidates: Vec<(std::time::SystemTime, std::path::PathBuf)> = rd
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    let name = p.file_name()?.to_str()?.to_string();
                    if name.starts_with("VisionPipe-") && name.ends_with(".md") {
                        let mtime = e.metadata().ok().and_then(|m| m.modified().ok())?;
                        Some((mtime, p))
                    } else {
                        None
                    }
                })
                .collect();
            candidates.sort_by(|a, b| b.0.cmp(&a.0));
            candidates.into_iter().next().map(|(_, p)| p.to_string_lossy().to_string())
        })
        .or_else(|| {
            let legacy = folder.join("transcript.md");
            if legacy.is_file() {
                Some(legacy.to_string_lossy().to_string())
            } else {
                None
            }
        });

    SessionSummary {
        id,
        folder: folder_str,
        created_at,
        label,
        screenshot_count,
        first_caption,
        transcript_snippet,
        thumbnail_paths,
        transcript_md_path,
    }
}

/// Return a concise tray-menu label for a session: time + count + caption.
fn format_session_menu_label(s: &SessionSummary) -> String {
    let count_part = if s.screenshot_count == 1 {
        "1 screenshot".to_string()
    } else {
        format!("{} screenshots", s.screenshot_count)
    };
    let caption_part = s.first_caption.as_ref()
        .map(|c| {
            let trimmed: String = c.chars().take(40).collect();
            format!(" — \"{}\"", trimmed)
        })
        .unwrap_or_default();
    format!("{} · {}{}", s.label, count_part, caption_part)
}

/// Tauri command: return up to `limit` recent session summaries for the
/// frontend History Hub.
#[tauri::command]
async fn list_recent_sessions_cmd(limit: Option<usize>) -> Result<Vec<SessionSummary>, String> {
    Ok(list_recent_sessions(limit.unwrap_or(50)))
}

/// Reveal a file in Finder by selecting it (`open -R <path>`).
/// Used by tray-menu session click + history row "Show in Finder" actions.
#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Refresh the tray menu's recent-sessions list. Called by the frontend
/// after END_SESSION so a just-ended bundle appears in the tray right-click
/// menu without an app restart.
#[tauri::command]
async fn refresh_tray(app: AppHandle) -> Result<(), String> {
    refresh_tray_menu(&app);
    Ok(())
}

/// Build the tray menu from the current recent-sessions list. Each session
/// becomes a menu item with ID `session_<idx>`; the click handler resolves
/// the index against `RecentSessionsState` to get the folder path, then
/// reveals it in Finder. Index-based addressing keeps the click handler
/// trivial (no string parsing of session IDs).
fn build_tray_menu(
    app: &AppHandle,
    recents: &[SessionSummary],
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    if recents.is_empty() {
        let label = MenuItem::with_id(
            app,
            "no_recents",
            "No recent sessions yet",
            false,
            None::<&str>,
        )?;
        items.push(Box::new(label));
    } else {
        let header = MenuItem::with_id(app, "recents_header", "Recent sessions", false, None::<&str>)?;
        items.push(Box::new(header));
        for (i, s) in recents.iter().enumerate() {
            let id = format!("session_{}", i);
            let label = format_session_menu_label(s);
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
/// the tray's menu in-place. Also updates the shared `RecentSessionsState`
/// so click dispatch uses the same folder list the menu was built from.
/// Cap at 10 sessions in the tray (per user request) — full list is in the
/// in-app History view.
fn refresh_tray_menu(app: &AppHandle) {
    let recents = list_recent_sessions(10);

    if let Some(state) = app.try_state::<RecentSessionsState>() {
        if let Ok(mut paths) = state.0.lock() {
            *paths = recents.iter().map(|s| s.folder.clone()).collect();
        }
    }

    if let Ok(menu) = build_tray_menu(app, &recents) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Capture a region of the screen and return the temp file path on disk.
/// Caller (typically App.tsx onCapture) is responsible for moving the
/// file into the session folder via `move_capture_to_session`.
///
/// Pre-v0.9.4 returned a base64 data URI of the PNG, which the JS side
/// then re-serialized as `Array.from(bytes)` to write to disk. For a
/// Retina capture (5-15 MB) that round-trip cost ~10-20 seconds. Now
/// the bytes never cross the IPC bridge.
#[tauri::command]
async fn take_screenshot(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    capture::capture_region(x, y, width, height)
        .map_err(|e| e.to_string())
}

/// Move a captured PNG from /tmp into the session folder under the
/// final canonical filename. Used by App.tsx after a screenshot lands
/// — the rename is intra-volume so it's near-instant. If the rename
/// crosses volumes (rare but possible), falls back to copy + delete.
#[tauri::command]
async fn move_capture_to_session(
    src_path: String,
    folder: String,
    filename: String,
) -> Result<String, String> {
    let src = std::path::PathBuf::from(&src_path);
    let dest = std::path::PathBuf::from(&folder).join(&filename);
    // Try a fast in-volume rename first.
    if let Err(rename_err) = std::fs::rename(&src, &dest) {
        // Fallback: copy + delete (handles cross-volume situations,
        // e.g., /tmp on a different filesystem from ~/Pictures/...).
        std::fs::copy(&src, &dest).map_err(|e| {
            format!("rename failed ({}); copy fallback also failed: {}", rename_err, e)
        })?;
        let _ = std::fs::remove_file(&src);
    }
    Ok(dest.to_string_lossy().to_string())
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

/// Write the markdown body to `<folder>/<filename>` AND copy that
/// file's path onto the macOS NSPasteboard as BOTH a string (the body
/// text, for paste-into-text-editor) AND a file URL (for paste-into-Finder
/// or drag-into-Claude-Code-as-file). Mirrors the dual-representation
/// pattern in `save_and_copy_image`. Returns the absolute path to the
/// written file. The `filename` parameter is optional — defaults to the
/// legacy `transcript.md` name if not provided, so old callers and
/// HistoryHub fallbacks keep working.
#[tauri::command]
async fn save_and_copy_markdown(folder: String, markdown: String, filename: Option<String>) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    let fname = filename.unwrap_or_else(|| "transcript.md".to_string());
    let path = std::path::PathBuf::from(&folder).join(&fname);
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

/// Request microphone access via native API (shows system prompt from
/// VisionPipe). Routed through `spawn_blocking` because the underlying
/// ObjC FFI uses a semaphore-blocking pattern that would otherwise stall
/// a tokio worker. Returns Ok(true) when granted, Ok(false) when denied,
/// and Err on timeout — the frontend treats Err as "we never heard back,
/// please open System Settings yourself" rather than silently reporting
/// denied.
#[tauri::command]
async fn request_microphone_access() -> Result<bool, String> {
    let outcome = tauri::async_runtime::spawn_blocking(speech::request_mic_auth)
        .await
        .map_err(|e| format!("blocking task error: {}", e))?;
    match outcome {
        speech::AuthOutcome::Granted => Ok(true),
        speech::AuthOutcome::Denied => Ok(false),
        speech::AuthOutcome::TimedOut => Err(
            "macOS didn't respond to the microphone permission request. \
             Open System Settings → Privacy & Security → Microphone and \
             enable Vision|Pipe manually.".to_string()
        ),
    }
}

/// Request speech recognition access via native API. Same spawn_blocking
/// + timeout-as-Err pattern as `request_microphone_access`.
#[tauri::command]
async fn request_speech_recognition() -> Result<bool, String> {
    let outcome = tauri::async_runtime::spawn_blocking(speech::request_speech_auth)
        .await
        .map_err(|e| format!("blocking task error: {}", e))?;
    match outcome {
        speech::AuthOutcome::Granted => Ok(true),
        speech::AuthOutcome::Denied => Ok(false),
        speech::AuthOutcome::TimedOut => Err(
            "macOS didn't respond to the speech-recognition permission request. \
             Open System Settings → Privacy & Security → Speech Recognition \
             and enable Vision|Pipe manually.".to_string()
        ),
    }
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

/// Stop the current cpal stream and DISCARD the captured samples — no
/// transcription, no return value. Used by the Cancel link in
/// RecordingControls when the user wants to throw away the current
/// recording without billing the user's time on a wasted SFSpeech run.
#[tauri::command]
async fn discard_recording() -> Result<(), String> {
    audio::discard_recording()
}

#[tauri::command]
async fn create_session_folder(session_id: String) -> Result<String, String> {
    session::create_session_folder(&session_id)
}

#[tauri::command]
async fn write_session_file(folder: String, filename: String, bytes: Vec<u8>) -> Result<String, String> {
    session::write_session_file(&folder, &filename, bytes)
}

/// Read raw bytes from <session_folder>/<filename>. Used by HistoryHub to
/// pull transcript.json or transcript.md back into the UI for re-rendering
/// or copying. Returned as Vec<u8> rather than String so binary files work
/// too (callers that want text decode it on the JS side).
#[tauri::command]
async fn read_session_file(folder: String, filename: String) -> Result<Vec<u8>, String> {
    let path = std::path::PathBuf::from(&folder).join(&filename);
    std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
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

/// Unregister all global keyboard shortcuts. Called from the Settings
/// panel when the user clicks a hotkey row to start a rebind — without
/// this, pressing the existing capture combo (e.g. ⌘⇧C) during the
/// rebind would also fire the global handler and pull focus away from
/// the Settings panel before the JS keydown listener could see it.
#[tauri::command]
async fn pause_global_shortcuts(app: AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())
}

/// Re-read the hotkey config from disk and re-register all global
/// shortcuts. Called from the Settings panel after a rebind finishes
/// (whether by capturing a new combo, or by Esc cancellation). Reading
/// from disk every time means a freshly-saved config is picked up
/// immediately — no app restart needed.
#[tauri::command]
async fn resume_global_shortcuts(app: AppHandle) -> Result<(), String> {
    register_global_shortcuts(&app)
}

/// Write text content to an arbitrary absolute path. Used by the
/// "Save to disk" affordance on the session footer: the frontend prompts
/// the user for a destination via the dialog plugin, then calls this with
/// the chosen path. Caller is responsible for path validation; this
/// command intentionally accepts any writable path so the user can pick
/// (e.g.) Desktop, Downloads, or an iCloud Drive subdir.
#[tauri::command]
async fn write_text_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Read current credit balance from the in-memory ledger.
#[tauri::command]
async fn get_credit_balance(
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
) -> Result<u64, String> {
    let l = ledger.lock().map_err(|e| e.to_string())?;
    Ok(l.balance)
}

/// Add credits (purchases, dev top-ups). Persists immediately.
#[tauri::command]
async fn add_credits(
    app: AppHandle,
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
    amount: u64,
) -> Result<u64, String> {
    let new_balance = {
        let mut l = ledger.lock().map_err(|e| e.to_string())?;
        l.balance = l.balance.saturating_add(amount);
        l.balance
    };
    save_balance(&app, new_balance)?;
    Ok(new_balance)
}

/// Pure preview of the bundle cost — no state mutation. Called by the
/// frontend whenever session state changes (debounced) so the header chip
/// can show "Cost: N" live.
#[tauri::command]
async fn preview_bundle_cost(
    screenshots: u64,
    annotations: u64,
    audio_seconds: u64,
) -> Result<credits::BundleCost, String> {
    Ok(credits::calculate_bundle_cost(screenshots, annotations, audio_seconds))
}

/// Calculate cost, deduct from the ledger, persist. Called once on
/// Copy & Send. Returns the deducted cost on success or an error string
/// on insufficient balance — caller MUST abort the side effect (clipboard
/// write) on Err.
#[tauri::command]
async fn deduct_for_bundle(
    app: AppHandle,
    ledger: tauri::State<'_, Mutex<credits::CreditLedger>>,
    screenshots: u64,
    annotations: u64,
    audio_seconds: u64,
) -> Result<credits::BundleCost, String> {
    let cost = credits::calculate_bundle_cost(screenshots, annotations, audio_seconds);
    let new_balance = {
        let mut l = ledger.lock().map_err(|e| e.to_string())?;
        l.deduct(&cost).map_err(|e| e.to_string())?;
        l.balance
    };
    save_balance(&app, new_balance)?;
    Ok(cost)
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
        .plugin(tauri_plugin_store::Builder::new().build())
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
            // shared mutex of recent session folder paths so click dispatch
            // can resolve `session_<N>` IDs back to a folder to reveal.
            app.manage(RecentSessionsState(Mutex::new(Vec::new())));
            // Stashed-metadata slot. Populated by every capture-trigger
            // path (hotkey, tray, in-app "+") BEFORE VP takes focus.
            // Drained by the next get_metadata invocation.
            app.manage(StashedMetadata(Mutex::new(None)));
            // Credit ledger: load persisted balance from tauri-plugin-store
            // (key: "credit_balance" in visionpipe.json), default 0.
            let initial_balance = load_balance(app.handle());
            app.manage(Mutex::new(credits::CreditLedger::new(initial_balance)));
            log::info!("[VisionPipe] Loaded credit balance: {}", initial_balance);
            let initial_recents = list_recent_sessions(10);
            if let Some(state) = app.try_state::<RecentSessionsState>() {
                if let Ok(mut paths) = state.0.lock() {
                    *paths = initial_recents.iter().map(|s| s.folder.clone()).collect();
                }
            }
            let menu = build_tray_menu(app.handle(), &initial_recents)?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("VisionPipe")
                .menu(&menu)
                // v0.6.1: left-click brings the main window forward (showing
                // HistoryHub if no session active) rather than opening the
                // native NSMenu. The previous behavior — left-click → text
                // menu listing recent sessions — felt empty: NSMenu can't
                // show thumbnails or per-row Copy/Folder buttons, so the
                // user couldn't actually DO anything from the dropdown
                // beyond opening the session folder. Right-click still
                // shows the native menu for the static actions
                // (Take Capture, Quit, etc.) for power users.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        // Refresh the menu list so right-click reflects any
                        // sessions added since startup. Cheap (~ms) since
                        // it's just a directory walk + metadata stats.
                        refresh_tray_menu(app);
                        if let Some(window) = app.get_webview_window("main") {
                            // Bring forward + focus. The window already
                            // renders the right view based on session state
                            // (HistoryHub when no session, SessionWindow
                            // otherwise) — see App.tsx view routing.
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
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
                        _ if id.starts_with("session_") => {
                            // session_<N>: open Nth session folder in Finder
                            // (lets user grab PNGs / transcript.md by drag).
                            if let Some(rest) = id.strip_prefix("session_") {
                                if let Ok(idx) = rest.parse::<usize>() {
                                    if let Some(state) = app.try_state::<RecentSessionsState>() {
                                        if let Ok(paths) = state.0.lock() {
                                            if let Some(folder) = paths.get(idx) {
                                                let _ = std::process::Command::new("open")
                                                    .arg(folder)
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

            // Register global shortcuts (factored out so the Settings
            // panel can pause/resume them during a rebind).
            if let Err(e) = register_global_shortcuts(app.handle()) {
                log::error!("[VisionPipe] Failed to register global shortcuts: {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_screenshot,
            take_scrolling_screenshot,
            capture_fullscreen,
            move_capture_to_session,
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
            discard_recording,
            create_session_folder,
            write_session_file,
            move_to_deleted,
            save_install_token,
            load_install_token,
            load_hotkey_config,
            save_hotkey_config,
            pause_global_shortcuts,
            resume_global_shortcuts,
            list_recent_sessions_cmd,
            reveal_in_finder,
            read_session_file,
            refresh_tray,
            write_text_to_path,
            get_credit_balance,
            add_credits,
            preview_bundle_cost,
            deduct_for_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
