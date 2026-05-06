use image::{ImageBuffer, Rgba};
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

/// Generate a unique temp path for a capture. Each invocation gets its
/// own filename so concurrent captures (unlikely, but possible if a
/// scrolling capture is mid-flight when another hotkey fires) don't
/// stomp each other.
fn fresh_temp_path() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("/tmp/visionpipe-capture-{}.png", nanos)
}

/// Capture the entire primary screen using macOS `screencapture`.
/// Returns the absolute path to the captured PNG on disk.
///
/// IMPORTANT: this used to base64-encode the PNG and return it as a data
/// URI — a 5-15 MB capture became a 20+ MB string that then crossed the
/// IPC bridge AGAIN as `Array.from(bytes)` (a JSON-serialised array of
/// numbers, ~4× the byte size as text) when the JS side wrote the file.
/// On a Retina capture this could take 20+ seconds. The new flow keeps
/// the bytes on disk — JS only ever sees a path string.
pub fn capture_fullscreen() -> Result<String, Box<dyn std::error::Error>> {
    let path = fresh_temp_path();

    let status = Command::new("screencapture")
        .args(["-x", "-r", &path]) // -x suppresses sound, -r captures at native (Retina) resolution
        .status()?;

    if !status.success() {
        return Err("screencapture failed".into());
    }

    log_capture_size(&path);
    Ok(path)
}

/// Capture a specific region of the screen using macOS `screencapture -R`.
/// Coordinates are in macOS point (logical) units.
/// Returns the absolute path to the captured PNG on disk.
pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, Box<dyn std::error::Error>> {
    let path = fresh_temp_path();
    let rect = format!("{},{},{},{}", x, y, width, height);

    let status = Command::new("screencapture")
        .args(["-R", &rect, "-x", "-r", &path])
        .status()?;

    if !status.success() {
        return Err("screencapture failed".into());
    }

    log_capture_size(&path);
    Ok(path)
}

fn log_capture_size(path: &str) {
    if let Ok(meta) = std::fs::metadata(path) {
        log::info!(
            "[VisionPipe] Captured PNG: {} bytes ({:.1} MB) at {}",
            meta.len(),
            meta.len() as f64 / 1_048_576.0,
            path,
        );
    }
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

    let stitched_path = fresh_temp_path();
    canvas.save(&stitched_path)?;

    log_capture_size(&stitched_path);
    for p in &frame_paths {
        let _ = std::fs::remove_file(p);
    }
    Ok(stitched_path)
}
