use image::ImageEncoder;
use screenshots::Screen;
use std::io::Cursor;
use base64::Engine;

pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, Box<dyn std::error::Error>> {
    let screens = Screen::all()?;
    let screen = screens.into_iter().next().ok_or("No screen found")?;

    let capture = screen.capture_area(x as i32, y as i32, width, height)?;

    // Encode as PNG
    let mut png_bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(Cursor::new(&mut png_bytes));
    encoder.write_image(
        capture.as_raw(),
        capture.width(),
        capture.height(),
        image::ExtendedColorType::Rgba8,
    )?;

    // Return as base64 data URI
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}
