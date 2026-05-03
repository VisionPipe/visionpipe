use std::fs;
use std::path::PathBuf;

/// Returns the absolute path to ~/Pictures/VisionPipe/ creating it if needed.
pub fn visionpipe_root() -> Result<PathBuf, String> {
    let pictures = dirs::picture_dir()
        .ok_or_else(|| "Could not resolve user pictures directory".to_string())?;
    let root = pictures.join("VisionPipe");
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create {}: {}", root.display(), e))?;
    Ok(root)
}

/// Creates a new session folder under ~/Pictures/VisionPipe/session-<id>/ and returns its absolute path.
pub fn create_session_folder(session_id: &str) -> Result<String, String> {
    let folder = visionpipe_root()?.join(format!("session-{}", session_id));
    fs::create_dir_all(&folder).map_err(|e| format!("Failed to create session folder: {}", e))?;
    fs::create_dir_all(folder.join(".deleted"))
        .map_err(|e| format!("Failed to create .deleted folder: {}", e))?;
    Ok(folder.to_string_lossy().into_owned())
}

/// Writes raw bytes to <session_folder>/<filename>. Used for screenshots, transcript.json, transcript.md, audio.
pub fn write_session_file(folder: &str, filename: &str, bytes: Vec<u8>) -> Result<String, String> {
    let path = PathBuf::from(folder).join(filename);
    fs::write(&path, bytes).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Soft-deletes a screenshot by moving it to <session_folder>/.deleted/.
pub fn move_to_deleted(folder: &str, filename: &str) -> Result<(), String> {
    let src = PathBuf::from(folder).join(filename);
    let dst = PathBuf::from(folder).join(".deleted").join(filename);
    fs::rename(&src, &dst).map_err(|e| format!("Failed to soft-delete: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_session_folder_makes_nested_dirs() {
        let test_id = format!("test-{}", chrono::Local::now().format("%Y%m%d%H%M%S%f"));
        let folder = create_session_folder(&test_id).expect("create_session_folder failed");
        let path = PathBuf::from(&folder);
        assert!(path.is_dir());
        assert!(path.join(".deleted").is_dir());
        // Cleanup
        fs::remove_dir_all(&path).ok();
    }

    #[test]
    fn write_session_file_writes_bytes() {
        let test_id = format!("test-{}", chrono::Local::now().format("%Y%m%d%H%M%S%f"));
        let folder = create_session_folder(&test_id).expect("create_session_folder failed");
        let path = write_session_file(&folder, "hello.txt", b"world".to_vec())
            .expect("write_session_file failed");
        let contents = fs::read_to_string(&path).expect("read failed");
        assert_eq!(contents, "world");
        fs::remove_dir_all(&folder).ok();
    }
}
