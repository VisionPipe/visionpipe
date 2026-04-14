fn main() {
    tauri_build::build();

    // Compile the Objective-C speech bridge into the app binary
    cc::Build::new()
        .file("src/speech_bridge.m")
        .flag("-fobjc-arc")
        .compile("speech_bridge");

    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
}
