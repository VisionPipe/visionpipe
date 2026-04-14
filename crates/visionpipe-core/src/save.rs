use base64::Engine;
use std::fs;

use crate::metadata::CaptureMetadata;

/// Save a captured screenshot (base64 data URI) and its metadata to ~/Pictures/VisionPipe/.
/// Returns (png_path, json_path).
pub fn save_capture(
    png_data_uri: &str,
    metadata: &CaptureMetadata,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let dir = format!("{}/Pictures/VisionPipe", home);
    fs::create_dir_all(&dir)?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let png_path = format!("{}/VisionPipe_{}.png", dir, timestamp);
    let json_path = format!("{}/VisionPipe_{}.json", dir, timestamp);

    // Decode base64 data URI to raw PNG bytes
    let b64_data = png_data_uri
        .strip_prefix("data:image/png;base64,")
        .ok_or("Invalid PNG data URI")?;
    let png_bytes = base64::engine::general_purpose::STANDARD.decode(b64_data)?;

    fs::write(&png_path, &png_bytes)?;
    eprintln!(
        "[VisionPipe] Saved {} ({} bytes)",
        png_path,
        png_bytes.len()
    );

    // Write metadata as JSON
    let json = serde_json::to_string_pretty(metadata)?;
    fs::write(&json_path, &json)?;

    Ok((png_path, json_path))
}
