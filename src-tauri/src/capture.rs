use base64::Engine;
use image::{ImageBuffer, Rgba};
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

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

/// Capture a scrolling screenshot of the same region across multiple
/// scroll positions. Between each capture, sends Page Down to whatever
/// app is focused so the target page scrolls; then captures again.
/// Stitches all the frames vertically into a single tall PNG.
///
/// Important: VisionPipe must be hidden when this runs so the target app
/// retains keyboard focus to receive the Page Down events. The frontend
/// is responsible for that (same as the regular region-capture flow).
///
/// Coordinates are in macOS point (logical) units, matching `capture_region`.
/// `num_scrolls` is the number of frames to capture (≥ 2). The first frame
/// is taken at the user's current scroll position; subsequent frames are
/// taken after each Page Down + 250ms settle delay.
pub fn capture_scrolling_region(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    num_scrolls: u32,
) -> Result<String, Box<dyn std::error::Error>> {
    let n = num_scrolls.max(2);
    let mut frame_paths: Vec<String> = Vec::with_capacity(n as usize);

    let rect = format!("{},{},{},{}", x, y, width, height);

    for i in 0..n {
        let path = format!("/tmp/visionpipe-scroll-{}.png", i);

        let status = Command::new("screencapture")
            .args(["-R", &rect, "-x", "-r", &path])
            .status()?;
        if !status.success() {
            return Err(format!("screencapture failed on frame {}", i).into());
        }
        frame_paths.push(path);

        if i < n - 1 {
            // Send Page Down to whatever app is currently focused.
            // Key code 121 = Page Down on macOS.
            let _ = Command::new("osascript")
                .args(["-e", "tell application \"System Events\" to key code 121"])
                .status();
            // Let the page finish scrolling before the next frame.
            sleep(Duration::from_millis(250));
        }
    }

    // Decode + stitch all frames vertically. They should all be the same
    // dimensions since we passed the same -R region every time. If
    // somehow they differ (display scale change?), bail with a clear error.
    let mut decoded: Vec<image::DynamicImage> = Vec::with_capacity(frame_paths.len());
    let mut total_height: u32 = 0;
    let mut common_width: Option<u32> = None;
    for path in &frame_paths {
        let img = image::open(path)?;
        let (w, h) = (img.width(), img.height());
        if let Some(cw) = common_width {
            if cw != w {
                return Err(format!("frame width mismatch: {} vs {}", cw, w).into());
            }
        } else {
            common_width = Some(w);
        }
        total_height = total_height.saturating_add(h);
        decoded.push(img);
    }
    let stitched_w = common_width.unwrap_or(0);
    if stitched_w == 0 || total_height == 0 {
        return Err("scrolling capture produced empty frames".into());
    }

    let mut canvas: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(stitched_w, total_height);
    let mut y_off: u32 = 0;
    for img in &decoded {
        let rgba = img.to_rgba8();
        image::imageops::overlay(&mut canvas, &rgba, 0, y_off as i64);
        y_off += img.height();
    }

    let stitched_path = "/tmp/visionpipe-scroll-stitched.png";
    canvas.save(stitched_path)?;

    let result = png_file_to_data_uri(stitched_path);
    let _ = std::fs::remove_file(stitched_path);
    for p in &frame_paths {
        let _ = std::fs::remove_file(p);
    }
    result
}
