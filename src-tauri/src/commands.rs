use crate::{cleanup, orthanc, security, storage};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ─── Study Commands ───────────────────────────────────────────────────────────

/// Get all studies currently in Orthanc (for display in OHIF worklist)
#[tauri::command]
pub async fn get_studies() -> Result<Vec<orthanc::OrthancStudy>, String> {
    orthanc::get_all_studies().await.map_err(|e| e.to_string())
}

/// Check if a study (by StudyInstanceUID) exists in Orthanc
#[tauri::command]
pub async fn check_study_in_orthanc(study_uid: String) -> Result<bool, String> {
    orthanc::find_study_by_uid(&study_uid)
        .await
        .map(|opt| opt.is_some())
        .map_err(|e| e.to_string())
}

/// Import study from local filesystem into Orthanc
/// Called when user clicks a study card that is not yet in Orthanc
#[tauri::command]
pub async fn import_study_to_orthanc(
    app: AppHandle,
    study_uid: String,
) -> Result<ImportResult, String> {
    let index = storage::load_study_index(&app).map_err(|e| e.to_string())?;

    let entry = index
        .entries
        .get(&study_uid)
        .ok_or_else(|| format!("Study {study_uid} not found in local storage"))?;

    let local_path = entry.local_path.clone();
    let instance_ids = storage::import_study_to_orthanc(&local_path)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ImportResult {
        study_uid,
        instance_count: instance_ids.len(),
        success: !instance_ids.is_empty(),
    })
}

/// Delete a study from Orthanc by Orthanc ID
#[tauri::command]
pub async fn delete_study_from_orthanc(orthanc_id: String) -> Result<(), String> {
    orthanc::delete_study(&orthanc_id)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a study from Orthanc by its DICOM StudyInstanceUID.
/// Used for ephemeral study cleanup at startup / on close.
#[tauri::command]
pub async fn delete_study_by_uid(study_uid: String) -> Result<(), String> {
    match orthanc::find_study_by_uid(&study_uid).await {
        Ok(Some(orthanc_id)) => orthanc::delete_study(&orthanc_id)
            .await
            .map_err(|e| e.to_string()),
        Ok(None) => Ok(()), // already gone
        Err(e) => Err(e.to_string()),
    }
}

// ─── Upload Commands ──────────────────────────────────────────────────────────

/// Upload raw DICOM files from the frontend (base64-encoded bytes)
#[tauri::command]
pub async fn upload_dicom_files(
    app: AppHandle,
    files: Vec<FileUpload>,
) -> Result<Vec<storage::SaveResult>, String> {
    let decoded: Vec<(String, Vec<u8>)> = files
        .into_iter()
        .map(|f| {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&f.data)
                .unwrap_or_default();
            (f.name, bytes)
        })
        .collect();

    let results = storage::save_dicom_files_to_storage(&app, decoded)
        .await
        .map_err(|e| e.to_string())?;

    // Also upload to Orthanc immediately
    for result in &results {
        if result.success {
            let _ = auto_import_to_orthanc(&app, &result.study_uid).await;
        }
    }

    Ok(results)
}

/// Upload a ZIP file (base64-encoded)
#[tauri::command]
pub async fn upload_zip(
    app: AppHandle,
    data: String,
    filename: String,
) -> Result<Vec<storage::SaveResult>, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;

    let extracted = storage::extract_zip(bytes).await.map_err(|e| e.to_string())?;

    if extracted.is_empty() {
        return Err(format!("No DICOM files found in {filename}"));
    }

    let results = storage::save_dicom_files_to_storage(&app, extracted)
        .await
        .map_err(|e| e.to_string())?;

    for result in &results {
        if result.success {
            let _ = auto_import_to_orthanc(&app, &result.study_uid).await;
        }
    }

    Ok(results)
}

/// Upload DICOM files given their absolute filesystem paths (used by drag-drop)
#[tauri::command]
pub async fn upload_dicom_paths(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<storage::SaveResult>, String> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for path in &paths {
        let lower = path.to_lowercase();
        if lower.ends_with(".zip") {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let extracted = storage::extract_zip(bytes).await.map_err(|e| e.to_string())?;
            files.extend(extracted);
        } else {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let name = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file.dcm")
                .to_string();
            files.push((name, bytes));
        }
    }

    if files.is_empty() {
        return Err("No DICOM files found in dropped paths".into());
    }

    let results = storage::save_dicom_files_to_storage(&app, files)
        .await
        .map_err(|e| e.to_string())?;

    for result in &results {
        if result.success {
            let _ = auto_import_to_orthanc(&app, &result.study_uid).await;
        }
    }

    Ok(results)
}

/// Upload an entire folder by scanning the local filesystem path
#[tauri::command]
pub async fn upload_folder(
    app: AppHandle,
    folder_path: String,
) -> Result<Vec<storage::SaveResult>, String> {
    let files = storage::scan_folder(&folder_path)
        .await
        .map_err(|e| e.to_string())?;

    if files.is_empty() {
        return Err(format!("No DICOM files found in {folder_path}"));
    }

    let results = storage::save_dicom_files_to_storage(&app, files)
        .await
        .map_err(|e| e.to_string())?;

    for result in &results {
        if result.success {
            let _ = auto_import_to_orthanc(&app, &result.study_uid).await;
        }
    }

    Ok(results)
}

async fn auto_import_to_orthanc(app: &AppHandle, study_uid: &str) -> anyhow::Result<()> {
    // Respect max studies limit before importing
    let settings_path = storage::get_settings_path(app)?;
    let max_studies = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)?;
        let v: serde_json::Value = serde_json::from_str(&content)?;
        v["orthanc"]["maxStudies"].as_u64().unwrap_or(30) as usize
    } else {
        30
    };

    cleanup::enforce_max_studies(max_studies).await?;

    let index = storage::load_study_index(app)?;
    if let Some(entry) = index.entries.get(study_uid) {
        storage::import_study_to_orthanc(&entry.local_path).await?;
    }

    Ok(())
}

// ─── Authentication Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn authenticate(
    app: AppHandle,
    username: String,
    password: String,
) -> Result<security::AuthResult, String> {
    security::authenticate(&app, &username, &password)
}

#[tauri::command]
pub async fn validate_session(token: String) -> Result<security::SessionInfo, String> {
    security::validate_session(&token)
}

#[tauri::command]
pub async fn logout_session(app: AppHandle, token: String) -> Result<(), String> {
    security::invalidate_session(&app, &token)
}

#[tauri::command]
pub async fn get_device_id(app: AppHandle) -> Result<String, String> {
    security::get_device_id(&app)
}

// ─── Secure Report Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn save_report(
    app: AppHandle,
    token: String,
    study_uid: String,
    report: Report,
) -> Result<(), String> {
    let report_json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    security::save_report_secure(&app, &token, &study_uid, &report_json)
}

#[tauri::command]
pub async fn load_report(
    app: AppHandle,
    token: String,
    study_uid: String,
) -> Result<Option<Report>, String> {
    match security::load_report_secure(&app, &token, &study_uid)? {
        Some(json) => {
            let report: Report = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(report))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn list_reports(app: AppHandle, token: String) -> Result<Vec<String>, String> {
    security::list_reports_secure(&app, &token)
}

// ─── Settings Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = storage::get_settings_path(&app).map_err(|e| e.to_string())?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    // Apply Orthanc URL change immediately without restart
    if let (Some(host), Some(port)) = (&settings.orthanc.host, settings.orthanc.port) {
        orthanc::set_orthanc_url(host, port);
    }

    let path = storage::get_settings_path(&app).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the current Orthanc URL so the frontend can update window.config
#[tauri::command]
pub async fn get_orthanc_url() -> String {
    orthanc::get_orthanc_url()
}

/// Return the port of the local CORS reverse proxy (0 if not yet started).
#[tauri::command]
pub async fn get_cors_proxy_port() -> u16 {
    crate::cors_proxy::get_proxy_port()
}

/// Return the absolute path to the settings.json file.
/// Useful for external config tools that want to read or modify Orthanc port/host.
#[tauri::command]
pub async fn get_settings_path_cmd(app: AppHandle) -> Result<String, String> {
    let path = storage::get_settings_path(&app).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ─── System / Status Commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn get_orthanc_status() -> OrthancStatus {
    let running = orthanc::is_orthanc_running().await;
    OrthancStatus {
        running,
        url: orthanc::get_orthanc_url(),
        dicomweb_root: orthanc::get_orthanc_dicomweb_root(),
    }
}

#[tauri::command]
pub async fn run_cleanup(max_studies: Option<usize>) -> Result<(), String> {
    cleanup::enforce_max_studies(max_studies.unwrap_or(30))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_storage_stats(app: AppHandle) -> Result<storage::StorageStats, String> {
    storage::get_storage_info(&app).map_err(|e| e.to_string())
}

// ─── File Dialog Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Option<Vec<String>> {
    use tauri_plugin_dialog::DialogExt;
    let paths = app
        .dialog()
        .file()
        .add_filter("DICOM Files", &["dcm", "DCM", "dicom"])
        .add_filter("ZIP Files", &["zip"])
        .add_filter("All Files", &["*"])
        .blocking_pick_files();

    paths.map(|p| {
        p.into_iter()
            .map(|f| f.to_string())
            .collect()
    })
}

#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog().file().blocking_pick_folder();
    path.map(|p| p.to_string())
}

// ─── PACS Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn query_pacs(config: PacsConfig, query: PacsQuery) -> Result<Vec<PacsStudy>, String> {
    // Use Orthanc's modalities API to query a remote PACS
    let client = reqwest::Client::new();

    // Register the modality in Orthanc
    let modality_body = serde_json::json!({
        "AET": config.ae_title,
        "Host": config.host,
        "Port": config.port,
        "AllowEcho": true,
        "AllowFind": true,
        "AllowMove": true
    });

    let modality_name = "remote_pacs";

    client
        .put(format!(
            "{}/modalities/{modality_name}",
            orthanc::get_orthanc_url()
        ))
        .json(&modality_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // C-FIND via Orthanc
    // NOTE: C-FIND only returns tags that are included in the Query object.
    // An empty string means "match any value and return it".
    // StudyInstanceUID MUST be included so we can identify and retrieve studies.
    let find_body = serde_json::json!({
        "Level": "Study",
        "Query": {
            "PatientName": query.patient_name.unwrap_or_default(),
            "StudyDescription": query.description.unwrap_or_default(),
            "StudyDate": query.date_range.unwrap_or_default(),
            "ModalitiesInStudy": query.modality.unwrap_or_default(),
            "StudyInstanceUID": "",
            "Modality": ""
        }
    });

    let results: serde_json::Value = client
        .post(format!(
            "{}/modalities/{modality_name}/query",
            orthanc::get_orthanc_url()
        ))
        .json(&find_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Answers are at /queries/{id}/answers
    let query_id = results["ID"].as_str().unwrap_or("");
    if query_id.is_empty() {
        return Err("PACS query did not return a query ID".to_string());
    }

    // First get list of answer indices
    let answer_indices: Vec<serde_json::Value> = client
        .get(format!(
            "{}/queries/{query_id}/answers",
            orthanc::get_orthanc_url()
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Fetch each answer's content individually (more reliable than ?expand)
    let mut answers: Vec<serde_json::Value> = Vec::new();
    for idx_val in &answer_indices {
        let idx = idx_val.as_u64().or_else(|| idx_val.as_str().and_then(|s| s.parse().ok())).unwrap_or(0);
        match client
            .get(format!(
                "{}/queries/{query_id}/answers/{idx}/content",
                orthanc::get_orthanc_url()
            ))
            .send()
            .await
        {
            Ok(resp) => {
                if let Ok(content) = resp.json::<serde_json::Value>().await {
                    // Wrap in a Content object so the extraction logic is consistent
                    answers.push(serde_json::json!({ "Content": content }));
                }
            }
            Err(e) => {
                tracing::warn!("Failed to fetch PACS answer {idx}: {e}");
            }
        }
    }

    // Orthanc ?expand wraps each answer as:
    //   { "Content": { "PatientName": { "Alphabetic": "SMITH^JOHN" }, "StudyDate": "20240101", ... }, "Index": N }
    //
    // DICOM JSON VR rules we handle:
    //   PN  (PersonName): { "Alphabetic": "..." } or { "Value": [{ "Alphabetic": "..." }] }
    //   DA/TM/UI/LO/SH: plain string or wrapped in "Value": ["..."]
    //
    // We also accept the flat-string form that some PACS servers return (e.g. older Orthanc,
    // DCM4CHEE, Horos) and the raw hex-tag DICOM JSON form used by others.
    let studies = answers
        .iter()
        .map(|a| {
            // Orthanc ?expand puts data under "Content"; plain DICOM JSON has no wrapper.
            let content = if a["Content"].is_object() { &a["Content"] } else { a };

            // Extract a plain string from any of the formats a PACS server might use.
            //
            // Orthanc's /queries/{id}/answers/{idx}/content returns its own proprietary
            // format where each tag is an object:
            //   "0010,0010": { "Name": "PatientName", "Type": "String", "Value": "SMITH^JOHN" }
            // Note: "Value" is a plain string here, NOT an array.
            // Note: hex tags use lowercase letters (e.g. "0020,000d" not "0020,000D").
            //
            // Other PACS servers / Orthanc endpoints may use:
            //   flat string:      content["PatientName"] = "SMITH^JOHN"
            //   PN Alphabetic:    content["PatientName"] = { "Alphabetic": "..." }
            //   DICOM JSON array: content["PatientName"] = { "Value": ["..."] }
            //   DICOM JSON PN:    content["PatientName"] = { "Value": [{ "Alphabetic": "..." }] }
            let str_field = |friendly: &str, hex: &str| -> String {
                // Also try lowercase version of the hex tag (Orthanc uses lowercase hex)
                let hex_lc = hex.to_lowercase();
                let hex_lc = hex_lc.as_str();

                // Helper: extract string value from a tag node in any known format
                let extract_node = |node: &serde_json::Value| -> Option<String> {
                    // Flat string
                    if let Some(s) = node.as_str() {
                        return Some(s.trim().to_string());
                    }
                    // Orthanc proprietary: { "Name": "...", "Type": "String", "Value": "..." }
                    // (Value is a plain string, not an array)
                    if let Some(s) = node["Value"].as_str() {
                        return Some(s.trim().to_string());
                    }
                    // PN Alphabetic: { "Alphabetic": "..." }
                    if let Some(s) = node["Alphabetic"].as_str() {
                        return Some(s.trim().to_string());
                    }
                    // DICOM JSON array: { "Value": ["..."] }
                    if let Some(s) = node["Value"][0].as_str() {
                        return Some(s.trim().to_string());
                    }
                    // DICOM JSON PN array: { "Value": [{ "Alphabetic": "..." }] }
                    if let Some(s) = node["Value"][0]["Alphabetic"].as_str() {
                        return Some(s.trim().to_string());
                    }
                    None
                };

                // Try friendly name first
                if let Some(s) = extract_node(&content[friendly]) { return s; }
                // Try hex tag (as provided, usually uppercase)
                if let Some(s) = extract_node(&content[hex]) { return s; }
                // Try hex tag lowercase (Orthanc uses lowercase hex in C-FIND responses)
                if let Some(s) = extract_node(&content[hex_lc]) { return s; }
                // Fallback: hex directly on `a` (format without Content wrapper)
                if let Some(s) = extract_node(&a[hex]) { return s; }
                if let Some(s) = extract_node(&a[hex_lc]) { return s; }

                String::new()
            };

            // PersonName fields use ^ delimiters; format as "Last, First Middle" when possible
            let fmt_pn = |raw: &str| -> String {
                if raw.is_empty() { return raw.to_string(); }
                // Replace any DICOM ^ with space — readable on all screens
                let parts: Vec<&str> = raw.splitn(5, '^').collect();
                let family = parts.first().copied().unwrap_or("").trim();
                let given  = parts.get(1).copied().unwrap_or("").trim();
                match (family.is_empty(), given.is_empty()) {
                    (false, false) => format!("{}, {}", family, given),
                    (false, true)  => family.to_string(),
                    _              => raw.to_string(),
                }
            };

            PacsStudy {
                patient_name: {
                    let n = str_field("PatientName", "0010,0010");
                    if n.is_empty() { String::new() } else { fmt_pn(&n) }
                },
                study_instance_uid: str_field("StudyInstanceUID", "0020,000D"),
                study_description: str_field("StudyDescription", "0008,1030"),
                study_date: str_field("StudyDate", "0008,0020"),
                modality: {
                    let m = str_field("ModalitiesInStudy", "0008,0061");
                    if m.is_empty() { str_field("Modality", "0008,0060") } else { m }
                },
            }
        })
        .collect();

    Ok(studies)
}

#[tauri::command]
pub async fn retrieve_from_pacs(
    config: PacsConfig,
    study_uid: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let modality_name = "remote_pacs";

    // Register modality
    let modality_body = serde_json::json!({
        "AET": config.ae_title,
        "Host": config.host,
        "Port": config.port
    });

    client
        .put(format!(
            "{}/modalities/{modality_name}",
            orthanc::get_orthanc_url()
        ))
        .json(&modality_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // C-MOVE to retrieve study into Orthanc
    let move_body = serde_json::json!({
        "Level": "Study",
        "Resources": [study_uid]
    });

    let resp: serde_json::Value = client
        .post(format!(
            "{}/modalities/{modality_name}/move",
            orthanc::get_orthanc_url()
        ))
        .json(&move_body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Retrieve job: {}", resp["ID"].as_str().unwrap_or("started")))
}

// ─── Data Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct FileUpload {
    pub name: String,
    pub data: String, // base64
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub study_uid: String,
    pub instance_count: usize,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Report {
    pub study_uid: String,
    pub patient_name: Option<String>,
    pub findings: String,
    pub impression: String,
    pub radiologist: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppSettings {
    pub theme: Option<String>,
    pub orthanc: OrthancSettings,
    pub pacs: Option<PacsConfig>,
    pub ai: AiSettings,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct OrthancSettings {
    pub max_studies: Option<u64>,
    pub host: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AiSettings {
    pub api_endpoint: Option<String>,
    pub api_key: Option<String>,
    pub enabled_models: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PacsConfig {
    pub ae_title: String,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PacsQuery {
    pub patient_name: Option<String>,
    pub description: Option<String>,
    pub date_range: Option<String>,
    pub modality: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PacsStudy {
    pub patient_name: String,
    pub study_instance_uid: String,
    pub study_description: String,
    pub study_date: String,
    pub modality: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OrthancStatus {
    pub running: bool,
    pub url: String,
    pub dicomweb_root: String,
}

// ─── Optical Drive Detection ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OpticalDrive {
    pub path: String,   // e.g. "D:\\"
    pub label: String,  // e.g. "D:"
    pub has_media: bool,
}

/// Return all CD/DVD drives currently visible to the OS.
/// On Windows uses GetLogicalDrives + GetDriveTypeW.
/// On macOS/Linux scans /Volumes and /media for optical mount points.
#[tauri::command]
pub fn list_optical_drives() -> Vec<OpticalDrive> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        extern "system" {
            fn GetLogicalDrives() -> u32;
            fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
            fn GetVolumeInformationW(
                lp_root_path_name: *const u16,
                lp_volume_name_buffer: *mut u16,
                n_volume_name_size: u32,
                lp_volume_serial_number: *mut u32,
                lp_maximum_component_length: *mut u32,
                lp_file_system_flags: *mut u32,
                lp_file_system_name_buffer: *mut u16,
                n_file_system_name_size: u32,
            ) -> i32;
        }

        const DRIVE_CDROM: u32 = 5;
        let mut drives = Vec::new();
        let mask = unsafe { GetLogicalDrives() };

        for bit in 0..26u32 {
            if mask & (1 << bit) == 0 {
                continue;
            }
            let letter = (b'A' + bit as u8) as char;
            let root: Vec<u16> = format!("{}:\\\0", letter).encode_utf16().collect();
            let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
            if drive_type == DRIVE_CDROM {
                // Check if media is present by trying to read the volume label
                let mut vol_buf = vec![0u16; 256];
                let has_media = unsafe {
                    GetVolumeInformationW(
                        root.as_ptr(),
                        vol_buf.as_mut_ptr(),
                        vol_buf.len() as u32,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        0,
                    ) != 0
                };
                drives.push(OpticalDrive {
                    path: format!("{}:\\", letter),
                    label: format!("{}:", letter),
                    has_media,
                });
            }
        }
        drives
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS: optical drives appear as /Volumes/... with "cdrom" in their device path
        // Linux:  /dev/sr* devices mounted under /media or /run/media
        let mut drives = Vec::new();

        // macOS
        #[cfg(target_os = "macos")]
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                let path = entry.path();
                // Use diskutil info to check if it's optical — approximate: check /dev/disk* type
                let path_str = path.to_string_lossy().to_string();
                // Heuristic: check if the backing device is optical via ioreg (skip for now, just expose all removable)
                let has_media = path.exists();
                if has_media {
                    drives.push(OpticalDrive {
                        label: entry.file_name().to_string_lossy().to_string(),
                        path: path_str,
                        has_media: true,
                    });
                }
            }
        }

        // Linux
        #[cfg(target_os = "linux")]
        for dev in ["sr0", "sr1", "cdrom"] {
            let dev_path = format!("/dev/{}", dev);
            if !std::path::Path::new(&dev_path).exists() {
                continue;
            }
            // Check if mounted
            if let Ok(mounts) = std::fs::read_to_string("/proc/mounts") {
                for line in mounts.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 && parts[0].contains(dev) {
                        drives.push(OpticalDrive {
                            path: parts[1].to_string(),
                            label: dev.to_string(),
                            has_media: true,
                        });
                    }
                }
            }
        }

        drives
    }
}
