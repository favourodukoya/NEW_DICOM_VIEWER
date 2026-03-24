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
    let find_body = serde_json::json!({
        "Level": "Study",
        "Query": {
            "PatientName": query.patient_name.unwrap_or_default(),
            "StudyDescription": query.description.unwrap_or_default(),
            "StudyDate": query.date_range.unwrap_or_default(),
            "ModalitiesInStudy": query.modality.unwrap_or_default()
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
    let answers: Vec<serde_json::Value> = client
        .get(format!(
            "{}/queries/{query_id}/answers?expand",
            orthanc::get_orthanc_url()
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let studies = answers
        .iter()
        .map(|a| {
            let tags = &a["0008,1030"]; // Study Description
            PacsStudy {
                patient_name: a["0010,0010"]["Value"][0]
                    .as_str()
                    .unwrap_or("Unknown")
                    .to_string(),
                study_instance_uid: a["0020,000D"]["Value"][0]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                study_description: tags["Value"][0].as_str().unwrap_or("").to_string(),
                study_date: a["0008,0020"]["Value"][0]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                modality: a["0008,0060"]["Value"][0].as_str().unwrap_or("").to_string(),
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
