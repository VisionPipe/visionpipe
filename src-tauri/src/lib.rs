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
async fn get_metadata() -> Result<metadata::CaptureMetadata, String> {
    Ok(metadata::collect_metadata())
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

            // Register global shortcut
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+C", move |_app, _shortcut, _event| {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("start-capture", ());
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![take_screenshot, get_metadata])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
