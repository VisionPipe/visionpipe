use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct HotkeyConfig {
    pub take_next_screenshot: String, // global
    pub copy_and_send: String,        // window-scoped
    pub rerecord_active: String,      // window-scoped
    pub toggle_view_mode: String,     // window-scoped
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            take_next_screenshot: "CmdOrCtrl+Shift+C".into(),
            copy_and_send: "CmdOrCtrl+Enter".into(),
            rerecord_active: "CmdOrCtrl+Shift+R".into(),
            toggle_view_mode: "CmdOrCtrl+T".into(),
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    let dir = dirs::config_dir().ok_or_else(|| "no config dir".to_string())?;
    let app_dir = dir.join("com.visionpipe.desktop");
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join("settings.json"))
}

pub fn load() -> HotkeyConfig {
    config_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &HotkeyConfig) -> Result<(), String> {
    let p = config_path()?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}
