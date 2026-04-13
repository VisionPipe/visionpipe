use base64::Engine;
use std::process::Command;

/// Read a PNG file from disk and return as a base64 data URI.
fn png_file_to_data_uri(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    let png_bytes = std::fs::read(path)?;
    eprintln!("[VisionPipe] Captured PNG: {} bytes ({:.1} MB)", png_bytes.len(), png_bytes.len() as f64 / 1_048_576.0);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Capture the entire primary screen using macOS `screencapture`.
/// Returns a full Retina-resolution PNG as a base64 data URI.
pub fn capture_fullscreen() -> Result<String, Box<dyn std::error::Error>> {
    let tmp = "/tmp/visionpipe-capture.png";

    let status = Command::new("screencapture")
        .args(["-x", "-r", tmp]) // -x suppresses sound, -r captures at native (Retina) resolution
        .status()?;

    if !status.success() {
        return Err("screencapture failed".into());
    }

    let result = png_file_to_data_uri(tmp);
    let _ = std::fs::remove_file(tmp);
    result
}

/// Capture a specific region of the screen using macOS `screencapture -R`.
/// Coordinates are in macOS point (logical) units.
/// Returns a full Retina-resolution PNG as a base64 data URI.
pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, Box<dyn std::error::Error>> {
    let tmp = "/tmp/visionpipe-capture.png";
    let rect = format!("{},{},{},{}", x, y, width, height);

    let status = Command::new("screencapture")
        .args(["-R", &rect, "-x", "-r", tmp]) // -r captures at native (Retina) resolution
        .status()?;

    if !status.success() {
        return Err("screencapture failed".into());
    }

    let result = png_file_to_data_uri(tmp);
    let _ = std::fs::remove_file(tmp);
    result
}
