#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Embed Info.plist keys directly into the binary so macOS TCC
    // can find them even when running outside a .app bundle (dev mode).
    embed_plist::embed_info_plist!("../Info.plist");
    visionpipe_lib::run()
}
