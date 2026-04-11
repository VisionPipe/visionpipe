use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct CaptureMetadata {
    pub app: String,
    pub window: String,
    pub resolution: String,
    pub scale: String,
    pub os: String,
    pub timestamp: String,
}

pub fn collect_metadata() -> CaptureMetadata {
    let (app, window) = get_frontmost_app();
    let (resolution, scale) = get_screen_info();
    let os = get_os_version();
    let timestamp = chrono::Utc::now().to_rfc3339();

    CaptureMetadata {
        app,
        window,
        resolution,
        scale,
        os,
        timestamp,
    }
}

#[cfg(target_os = "macos")]
fn get_frontmost_app() -> (String, String) {
    // Get the frontmost application name via AppleScript
    let app = Command::new("osascript")
        .args(["-e", r#"tell application "System Events" to get name of first application process whose frontmost is true"#])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    // Get the frontmost window title
    let window = Command::new("osascript")
        .args(["-e", &format!(
            r#"tell application "System Events" to get name of front window of application process "{}""#,
            app
        )])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    (app, window)
}

#[cfg(not(target_os = "macos"))]
fn get_frontmost_app() -> (String, String) {
    ("Unknown".to_string(), "Unknown".to_string())
}

#[cfg(target_os = "macos")]
fn get_screen_info() -> (String, String) {
    // Get main screen resolution via system_profiler
    let output = Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok());

    if let Some(json_str) = output {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
            if let Some(displays) = val["SPDisplaysDataType"]
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|gpu| gpu["spdisplays_ndrvs"].as_array())
                .and_then(|arr| arr.first())
            {
                let res = displays["_spdisplays_resolution"]
                    .as_str()
                    .unwrap_or("Unknown")
                    .to_string();
                let retina = if displays["spdisplays_retina"]
                    .as_str()
                    .unwrap_or("")
                    .contains("Yes")
                {
                    "2x".to_string()
                } else {
                    "1x".to_string()
                };
                return (res, retina);
            }
        }
    }

    ("Unknown".to_string(), "1x".to_string())
}

#[cfg(not(target_os = "macos"))]
fn get_screen_info() -> (String, String) {
    ("Unknown".to_string(), "1x".to_string())
}

fn get_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sw_vers")
            .args(["-productVersion"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| format!("macOS {}", s.trim()))
            .unwrap_or_else(|| "macOS".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        "Windows".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Linux".to_string()
    }
}
