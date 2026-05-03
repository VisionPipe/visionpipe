// Mirrors the Rust PermissionStatus struct in src-tauri/src/permissions.rs
// (serde rename_all = "camelCase" matches these field names exactly).
export interface PermissionStatus {
  screenRecording: boolean;
  systemEvents: boolean;
  accessibility: boolean;
  microphone: boolean;
  speechRecognition: boolean;
}
