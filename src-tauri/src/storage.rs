use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;
use chrono::{DateTime, Utc};

/// Root directory for permanent local study storage
pub fn get_studies_dir(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Cannot get app data dir: {e}"))?;
    let studies_dir = data_dir.join("studies");
    std::fs::create_dir_all(&studies_dir)?;
    Ok(studies_dir)
}

/// Root directory for reports
pub fn get_reports_dir(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Cannot get app data dir: {e}"))?;
    let reports_dir = data_dir.join("reports");
    std::fs::create_dir_all(&reports_dir)?;
    Ok(reports_dir)
}

/// Settings file path
pub fn get_settings_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Cannot get app data dir: {e}"))?;
    Ok(data_dir.join("settings.json"))
}

/// Index file that maps StudyInstanceUID -> local folder path
pub fn get_index_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Cannot get app data dir: {e}"))?;
    Ok(data_dir.join("study_index.json"))
}

/// Load the study index (UID -> folder mapping)
pub fn load_study_index(app: &AppHandle) -> Result<StudyIndex> {
    let path = get_index_path(app)?;
    if !path.exists() {
        return Ok(StudyIndex::default());
    }
    let content = std::fs::read_to_string(&path)?;
    let index: StudyIndex = serde_json::from_str(&content)?;
    Ok(index)
}

/// Save the study index
pub fn save_study_index(app: &AppHandle, index: &StudyIndex) -> Result<()> {
    let path = get_index_path(app)?;
    let content = serde_json::to_string_pretty(index)?;
    std::fs::write(path, content)?;
    Ok(())
}

/// Save DICOM files from a list of (filename, bytes) to local storage.
/// Returns the StudyInstanceUID (inferred from DICOM or from a UUID folder name).
pub async fn save_dicom_files_to_storage(
    app: &AppHandle,
    files: Vec<(String, Vec<u8>)>,
) -> Result<Vec<SaveResult>> {
    let studies_dir = get_studies_dir(app)?;
    let mut index = load_study_index(app)?;
    let mut results: Vec<SaveResult> = Vec::new();

    // Group files by StudyInstanceUID by parsing the DICOM tag (0020,000D)
    // For simplicity, we store each upload batch in a UUID-named subfolder
    // and try to read the UID from the first file's DICOM header.
    let upload_id = uuid::Uuid::new_v4().to_string();

    for (filename, data) in files {
        // Try to extract StudyInstanceUID from DICOM data
        let study_uid = extract_study_uid_from_dicom(&data)
            .unwrap_or_else(|| format!("unknown-{upload_id}"));

        let study_dir = studies_dir.join(&study_uid);
        std::fs::create_dir_all(&study_dir)?;

        let file_path = study_dir.join(&filename);
        std::fs::write(&file_path, &data)?;

        // Update index
        index.entries.insert(
            study_uid.clone(),
            StudyIndexEntry {
                study_uid: study_uid.clone(),
                local_path: study_dir.to_string_lossy().to_string(),
                added_at: Utc::now(),
                last_accessed: Utc::now(),
            },
        );

        results.push(SaveResult {
            filename,
            study_uid,
            success: true,
            error: None,
        });
    }

    save_study_index(app, &index)?;
    Ok(results)
}

/// Extract StudyInstanceUID (0020,000D) from raw DICOM bytes.
/// Uses a minimal hand-rolled parser — no external DICOM library required.
fn extract_study_uid_from_dicom(data: &[u8]) -> Option<String> {
    // DICOM preamble is 128 bytes + "DICM" magic
    if data.len() < 132 {
        return None;
    }
    if &data[128..132] != b"DICM" {
        return None;
    }

    // StudyInstanceUID tag = (0020,000D) in little-endian: 20 00 0D 00
    let target = [0x20u8, 0x00, 0x0D, 0x00];
    let search_space = &data[132..];

    let pos = search_space
        .windows(4)
        .position(|w| w == target)?;

    // After the 4-byte tag comes VR (2 bytes) and length (2 or 4 bytes)
    // For UI VR: tag(4) + VR(2) + reserved(2) + length(4) = 12 bytes before value
    // but simpler: scan past the tag and read length
    let after_tag = pos + 4;
    if after_tag + 8 > search_space.len() {
        return None;
    }

    let vr = &search_space[after_tag..after_tag + 2];
    let (value_offset, value_len) = if vr == b"UI" || vr == b"LO" || vr == b"CS" {
        // Explicit VR short form: tag(4) + VR(2) + length(2)
        let len = u16::from_le_bytes([search_space[after_tag + 2], search_space[after_tag + 3]]) as usize;
        (after_tag + 4, len)
    } else {
        // Try explicit VR long form or implicit VR (4-byte length)
        let len = u32::from_le_bytes([
            search_space[after_tag + 4],
            search_space[after_tag + 5],
            search_space[after_tag + 6],
            search_space[after_tag + 7],
        ]) as usize;
        (after_tag + 8, len)
    };

    if value_offset + value_len > search_space.len() {
        return None;
    }

    let uid_bytes = &search_space[value_offset..value_offset + value_len];
    let uid = std::str::from_utf8(uid_bytes)
        .ok()?
        .trim_matches('\0')
        .trim()
        .to_string();

    if uid.is_empty() {
        None
    } else {
        Some(uid)
    }
}

/// Extract a ZIP file and return (filename, bytes) pairs for all .dcm files
pub async fn extract_zip(zip_data: Vec<u8>) -> Result<Vec<(String, Vec<u8>)>> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(zip_data);
    let mut archive = zip::ZipArchive::new(cursor)?;
    let mut files = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_lowercase();
        if name.ends_with(".dcm") || !name.contains('.') {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)?;
            let short_name = Path::new(file.name())
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("file_{i}.dcm"));
            files.push((short_name, buf));
        }
    }

    Ok(files)
}

/// Scan a folder path and return (filename, bytes) for all DICOM files
pub async fn scan_folder(folder_path: &str) -> Result<Vec<(String, Vec<u8>)>> {
    let mut files = Vec::new();

    for entry in WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let is_dicom = ext == "dcm" || ext.is_empty();
        if is_dicom {
            let data = std::fs::read(path)?;
            // Quick DICOM magic check
            if data.len() >= 132 && &data[128..132] == b"DICM" {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                files.push((name, data));
            }
        }
    }

    Ok(files)
}

/// Import a study from local storage into Orthanc.
/// Returns list of Orthanc instance IDs created.
pub async fn import_study_to_orthanc(local_path: &str) -> Result<Vec<String>> {
    use crate::orthanc::upload_dicom_buffer;
    let mut instance_ids = Vec::new();

    for entry in WalkDir::new(local_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let data = std::fs::read(path)?;
        if data.len() >= 132 && &data[128..132] == b"DICM" {
            match upload_dicom_buffer(data).await {
                Ok(id) => instance_ids.push(id),
                Err(e) => tracing::warn!("Failed to upload {}: {e}", path.display()),
            }
        }
    }

    Ok(instance_ids)
}

/// Get storage statistics
pub fn get_storage_info(app: &AppHandle) -> Result<StorageStats> {
    let studies_dir = get_studies_dir(app)?;
    let mut total_bytes: u64 = 0;
    let mut study_count = 0;

    if studies_dir.exists() {
        for entry in WalkDir::new(&studies_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
        study_count = studies_dir
            .read_dir()
            .map(|rd| rd.count())
            .unwrap_or(0);
    }

    Ok(StorageStats {
        total_bytes,
        study_count,
        studies_dir: studies_dir.to_string_lossy().to_string(),
    })
}

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct StudyIndex {
    pub entries: std::collections::HashMap<String, StudyIndexEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyIndexEntry {
    pub study_uid: String,
    pub local_path: String,
    pub added_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub filename: String,
    pub study_uid: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageStats {
    pub total_bytes: u64,
    pub study_count: usize,
    pub studies_dir: String,
}
