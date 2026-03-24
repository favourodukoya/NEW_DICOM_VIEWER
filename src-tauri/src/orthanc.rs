use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

static ORTHANC_BASE_URL: Lazy<RwLock<String>> =
    Lazy::new(|| RwLock::new("http://127.0.0.1:8042".to_string()));

/// Get the current Orthanc base URL (may be changed via settings).
pub fn get_orthanc_url() -> String {
    ORTHANC_BASE_URL.read().unwrap().clone()
}

/// Update the Orthanc URL at runtime (called when settings are saved).
pub fn set_orthanc_url(host: &str, port: u16) {
    let url = format!("http://{}:{}", host, port);
    *ORTHANC_BASE_URL.write().unwrap() = url;
}

pub fn get_orthanc_dicomweb_root() -> String {
    format!("{}/dicom-web", get_orthanc_url())
}

/// Start Orthanc as a sidecar process managed by Tauri.
/// The binary must be placed at: src-tauri/binaries/Orthanc-<target>
pub async fn start_orthanc(app: &AppHandle) -> Result<()> {
    let config_path = get_orthanc_config_path(app)?;

    tracing::info!("Starting Orthanc with config: {}", config_path.display());

    let shell = app.shell();
    let (mut _rx, _child) = shell
        .sidecar("Orthanc")
        .map_err(|e| anyhow!("Orthanc sidecar not found: {e}"))?
        .args([config_path.to_str().unwrap_or_default()])
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn Orthanc: {e}"))?;

    // Wait for Orthanc to be ready
    wait_for_orthanc_ready().await?;

    tracing::info!("Orthanc is ready at {}", get_orthanc_url());
    Ok(())
}

/// Write the Orthanc configuration file to the app data directory.
pub fn get_orthanc_config_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Cannot get app data dir: {e}"))?;

    let config_dir = data_dir.join("orthanc");
    std::fs::create_dir_all(&config_dir)?;

    let storage_dir = data_dir.join("orthanc_storage");
    std::fs::create_dir_all(&storage_dir)?;

    let db_dir = data_dir.join("orthanc_db");
    std::fs::create_dir_all(&db_dir)?;

    let config_path = config_dir.join("orthanc.json");

    // Always regenerate the config so performance tuning and setting changes
    // take effect without requiring a manual file deletion.
    let config = build_orthanc_config(&storage_dir, &db_dir);
    std::fs::write(&config_path, config)?;

    Ok(config_path)
}

fn build_orthanc_config(storage_dir: &PathBuf, db_dir: &PathBuf) -> String {
    format!(
        r#"{{
  "StorageDirectory": "{storage}",
  "IndexDirectory": "{db}",
  "HttpPort": 8042,
  "DicomPort": 4242,
  "AuthenticationEnabled": false,
  "RemoteAccessAllowed": true,
  "HttpCompressionEnabled": false,
  "Plugins": ["./DicomWebPlugin"],
  "DicomWeb": {{
    "Enable": true,
    "Root": "/dicom-web/",
    "EnableWado": true,
    "WadoRoot": "/wado",
    "Ssl": false,
    "QidoCaseSensitive": false,
    "Host": "127.0.0.1",
    "StudiesMetadata": "MainDicomTags",
    "SeriesMetadata": "Full"
  }},
  "Cors": {{
    "AllowedOrigins": ["*"],
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  }},
  "LogLevel": "WARNING",
  "HttpVerbose": false,
  "KeepAlive": true,
  "TcpNoDelay": true,
  "HttpThreadsCount": 64,
  "HttpRequestTimeout": 0,
  "ConcurrentJobs": 4,
  "MaximumStorageSize": 0,
  "MaximumPatientCount": 0
}}"#,
        storage = storage_dir.display(),
        db = db_dir.display()
    )
}

async fn wait_for_orthanc_ready() -> Result<()> {
    let client = reqwest::Client::new();
    let mut attempts = 0;
    let max_attempts = 30;

    loop {
        attempts += 1;
        match client
            .get(format!("{}/system", get_orthanc_url()))
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                if attempts >= max_attempts {
                    return Err(anyhow!("Orthanc did not start within {max_attempts} seconds"));
                }
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

/// Check if Orthanc is running
pub async fn is_orthanc_running() -> bool {
    let client = reqwest::Client::new();
    client
        .get(format!("{}/system", get_orthanc_url()))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Get all studies currently in Orthanc with their metadata
pub async fn get_all_studies() -> Result<Vec<OrthancStudy>> {
    let client = reqwest::Client::new();

    let ids: Vec<String> = client
        .get(format!("{}/studies", get_orthanc_url()))
        .send()
        .await?
        .json()
        .await?;

    let mut studies = Vec::new();
    for id in ids {
        match get_study_details(&client, &id).await {
            Ok(study) => studies.push(study),
            Err(e) => tracing::warn!("Failed to get study {id}: {e}"),
        }
    }

    Ok(studies)
}

async fn get_study_details(client: &reqwest::Client, orthanc_id: &str) -> Result<OrthancStudy> {
    let meta: serde_json::Value = client
        .get(format!("{}/studies/{orthanc_id}?requestedTags=ModalitiesInStudy", get_orthanc_url()))
        .send()
        .await?
        .json()
        .await?;

    let main_tags = &meta["MainDicomTags"];
    let patient_tags = &meta["PatientMainDicomTags"];

    Ok(OrthancStudy {
        orthanc_id: orthanc_id.to_string(),
        study_instance_uid: main_tags["StudyInstanceUID"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        patient_name: patient_tags["PatientName"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
        patient_id: patient_tags["PatientID"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        study_description: main_tags["StudyDescription"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        study_date: main_tags["StudyDate"].as_str().unwrap_or("").to_string(),
        modalities: meta["RequestedTags"]["ModalitiesInStudy"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        series_count: meta["Series"].as_array().map(|a| a.len()).unwrap_or(0),
        instance_count: meta["Instances"].as_array().map(|a| a.len()).unwrap_or(0),
        last_update: meta["LastUpdate"].as_str().unwrap_or("").to_string(),
    })
}

/// Upload a single DICOM file buffer to Orthanc
pub async fn upload_dicom_buffer(data: Vec<u8>) -> Result<String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(format!("{}/instances", get_orthanc_url()))
        .header("Content-Type", "application/dicom")
        .body(data)
        .send()
        .await?
        .json()
        .await?;

    let id = resp["ID"].as_str().unwrap_or("").to_string();
    Ok(id)
}

/// Delete a study from Orthanc by its Orthanc ID
pub async fn delete_study(orthanc_id: &str) -> Result<()> {
    let client = reqwest::Client::new();
    client
        .delete(format!("{}/studies/{orthanc_id}", get_orthanc_url()))
        .send()
        .await?;
    Ok(())
}

/// Find Orthanc study ID by StudyInstanceUID
pub async fn find_study_by_uid(study_uid: &str) -> Result<Option<String>> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "Level": "Study",
        "Query": {
            "StudyInstanceUID": study_uid
        }
    });

    let results: Vec<String> = client
        .post(format!("{}/tools/find", get_orthanc_url()))
        .json(&body)
        .send()
        .await?
        .json()
        .await?;

    Ok(results.into_iter().next())
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct OrthancStudy {
    pub orthanc_id: String,
    pub study_instance_uid: String,
    pub patient_name: String,
    pub patient_id: String,
    pub study_description: String,
    pub study_date: String,
    pub modalities: String,
    pub series_count: usize,
    pub instance_count: usize,
    pub last_update: String,
}
