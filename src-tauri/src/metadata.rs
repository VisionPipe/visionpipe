use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    pub app: String,
    pub window: String,
    pub resolution: String,
    pub scale: String,
    pub os: String,
    pub os_build: String,
    pub timestamp: String,
    pub hostname: String,
    pub username: String,
    pub locale: String,
    pub timezone: String,
    pub display_count: u32,
    pub primary_display: String,
    pub color_space: String,
    pub cpu: String,
    pub memory_gb: String,
    pub dark_mode: bool,
    pub battery: String,
    pub uptime: String,
    pub active_url: String,
}

pub fn collect_metadata() -> CaptureMetadata {
    let (app, window) = get_frontmost_app();
    let (resolution, scale) = get_screen_info();
    let os = get_os_version();
    let os_build = get_os_build();
    let timestamp = chrono::Utc::now().to_rfc3339();
    let hostname = get_hostname();
    let username = get_username();
    let locale = get_locale();
    let timezone = get_timezone();
    let (display_count, primary_display) = get_display_info();
    let color_space = get_color_space();
    let cpu = get_cpu();
    let memory_gb = get_memory();
    let dark_mode = get_dark_mode();
    let battery = get_battery();
    let uptime = get_uptime();
    let active_url = get_active_url(&app);

    CaptureMetadata {
        app,
        window,
        resolution,
        scale,
        os,
        os_build,
        timestamp,
        hostname,
        username,
        locale,
        timezone,
        display_count,
        primary_display,
        color_space,
        cpu,
        memory_gb,
        dark_mode,
        battery,
        uptime,
        active_url,
    }
}

// ── App & Window ──

#[cfg(target_os = "macos")]
fn get_frontmost_app() -> (String, String) {
    let app = Command::new("osascript")
        .args(["-e", r#"tell application "System Events" to get name of first application process whose frontmost is true"#])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let window = Command::new("osascript")
        .args(["-e", &format!(
            r#"tell application "System Events" to get name of front window of application process "{}""#,
            app
        )])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "".to_string());

    (app, window)
}

#[cfg(not(target_os = "macos"))]
fn get_frontmost_app() -> (String, String) {
    ("Unknown".to_string(), "".to_string())
}

// ── Screen Info ──

#[cfg(target_os = "macos")]
fn get_screen_info() -> (String, String) {
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

// ── OS Version ──

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
    { "Windows".to_string() }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { "Linux".to_string() }
}

fn get_os_build() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sw_vers")
            .args(["-buildVersion"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    { String::new() }
}

// ── System Info ──

fn get_hostname() -> String {
    Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn get_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn get_locale() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("defaults")
            .args(["read", "-g", "AppleLocale"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "en_US".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { "en_US".to_string() }
}

fn get_timezone() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args(["-e", r#"do shell script "date +%Z""#])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    { String::new() }
}

// ── Display Info ──

fn get_display_info() -> (u32, String) {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("system_profiler")
            .args(["SPDisplaysDataType", "-json"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok());

        if let Some(json_str) = output {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                let mut count = 0u32;
                let mut primary = String::new();
                if let Some(gpus) = val["SPDisplaysDataType"].as_array() {
                    for gpu in gpus {
                        if let Some(displays) = gpu["spdisplays_ndrvs"].as_array() {
                            for display in displays {
                                count += 1;
                                if primary.is_empty() {
                                    primary = display["_name"]
                                        .as_str()
                                        .unwrap_or("Unknown")
                                        .to_string();
                                }
                            }
                        }
                    }
                }
                return (count, primary);
            }
        }
        (1, "Unknown".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { (1, "Unknown".to_string()) }
}

fn get_color_space() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args(["-e", r#"do shell script "colorsync -info 2>/dev/null | head -1 || echo 'sRGB'"#])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| {
                let trimmed = s.trim().to_string();
                if trimmed.is_empty() { "sRGB IEC61966-2.1".to_string() } else { trimmed }
            })
            .unwrap_or_else(|| "sRGB IEC61966-2.1".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { "sRGB".to_string() }
}

// ── Hardware ──

fn get_cpu() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    { String::new() }
}

fn get_memory() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|bytes| format!("{} GB", bytes / (1024 * 1024 * 1024)))
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    { String::new() }
}

fn get_dark_mode() -> bool {
    #[cfg(target_os = "macos")]
    {
        Command::new("defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_lowercase().contains("dark"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    { false }
}

fn get_battery() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("pmset")
            .args(["-g", "batt"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| {
                // Extract percentage and charging status
                for line in s.lines() {
                    if line.contains('%') {
                        let parts: Vec<&str> = line.split('\t').collect();
                        if parts.len() >= 2 {
                            return parts[1].trim().to_string();
                        }
                    }
                }
                "Unknown".to_string()
            })
            .unwrap_or_else(|| "Unknown".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    { "Unknown".to_string() }
}

fn get_uptime() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("uptime")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| {
                // Extract just the uptime portion
                if let Some(idx) = s.find("up ") {
                    let rest = &s[idx + 3..];
                    if let Some(end) = rest.find(" user") {
                        // Go back to find the comma before "N user"
                        let segment = &rest[..end];
                        if let Some(comma) = segment.rfind(',') {
                            return segment[..comma].trim().to_string();
                        }
                        return segment.trim().to_string();
                    }
                    return rest.trim().to_string();
                }
                s.trim().to_string()
            })
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    { String::new() }
}

// ── Browser URL (via Accessibility) ──

fn get_active_url(app: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        let browser = app.to_lowercase();
        if browser.contains("safari") || browser.contains("chrome") || browser.contains("firefox")
            || browser.contains("arc") || browser.contains("brave") || browser.contains("edge")
            || browser.contains("opera") || browser.contains("vivaldi")
        {
            // Try to get URL from the browser
            let script = if browser.contains("safari") {
                format!(r#"tell application "{}" to get URL of front document"#, app)
            } else {
                // Chrome-based browsers
                format!(r#"tell application "{}" to get URL of active tab of front window"#, app)
            };
            return Command::new("osascript")
                .args(["-e", &script])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
        }
        String::new()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        String::new()
    }
}
