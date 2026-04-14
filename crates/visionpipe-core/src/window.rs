use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub owner: String,
    pub name: String,
}

/// List all visible on-screen windows using macOS CGWindowListCopyWindowInfo via JXA.
/// Returns a list of windows with their CGWindowID, owning app name, and window title.
pub fn list_windows() -> Result<Vec<WindowInfo>, Box<dyn std::error::Error>> {
    let jxa = r#"
ObjC.import('Cocoa');
var windows = $.CGWindowListCopyWindowInfo(1, 0);
var bridged = ObjC.castRefToObject(windows);
var count = bridged.count;
var result = [];
for (var i = 0; i < count; i++) {
    var d = bridged.objectAtIndex(i);
    var owner = ObjC.unwrap(d.objectForKey('kCGWindowOwnerName')) || '';
    var name = ObjC.unwrap(d.objectForKey('kCGWindowName')) || '';
    var wid = ObjC.unwrap(d.objectForKey('kCGWindowNumber')) || 0;
    var layer = ObjC.unwrap(d.objectForKey('kCGWindowLayer')) || 0;
    if (owner !== '' && layer === 0) {
        result.push({ id: wid, owner: owner, name: name });
    }
}
JSON.stringify(result);
"#;

    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", jxa])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list windows: {}", stderr).into());
    }

    let stdout = String::from_utf8(output.stdout)?;
    let windows: Vec<WindowInfo> = serde_json::from_str(stdout.trim())?;
    Ok(windows)
}

/// Find the CGWindowID for a given app name (case-insensitive substring match).
/// Returns the ID of the first matching window.
pub fn find_window_id(app_name: &str) -> Result<u32, Box<dyn std::error::Error>> {
    let windows = list_windows()?;
    let app_lower = app_name.to_lowercase();

    let matched = windows.iter().find(|w| w.owner.to_lowercase().contains(&app_lower));

    match matched {
        Some(w) => Ok(w.id),
        None => {
            let available: Vec<String> = windows
                .iter()
                .map(|w| w.owner.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            Err(format!(
                "No window found for '{}'. Available apps: {}",
                app_name,
                available.join(", ")
            )
            .into())
        }
    }
}
