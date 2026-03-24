use crate::orthanc;
use crate::storage;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::interval;

const DEFAULT_MAX_STUDIES: usize = 30;
const CLEANUP_INTERVAL_SECS: u64 = 300; // every 5 minutes

/// Runs the cleanup scheduler indefinitely.
pub async fn run_cleanup_scheduler(app: AppHandle) {
    let mut ticker = interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));

    loop {
        ticker.tick().await;

        let settings = load_cleanup_settings(&app);
        let max_studies = settings.max_studies_in_orthanc.unwrap_or(DEFAULT_MAX_STUDIES);

        if let Err(e) = enforce_max_studies(max_studies).await {
            tracing::warn!("Cleanup error: {e}");
        }
    }
}

/// Remove LRU studies from Orthanc until the count is <= max_studies.
pub async fn enforce_max_studies(max_studies: usize) -> Result<()> {
    let client = reqwest::Client::new();

    // Get all study IDs
    let study_ids: Vec<String> = client
        .get(format!("{}/studies", orthanc::get_orthanc_url()))
        .timeout(Duration::from_secs(5))
        .send()
        .await?
        .json()
        .await?;

    if study_ids.len() <= max_studies {
        return Ok(());
    }

    // Fetch last-update timestamps for all studies
    let mut studies_with_time: Vec<(String, DateTime<Utc>)> = Vec::new();

    for id in &study_ids {
        if let Ok(meta) = client
            .get(format!("{}/studies/{}", orthanc::get_orthanc_url(), id))
            .send()
            .await
        {
            if let Ok(json) = meta.json::<serde_json::Value>().await {
                let ts_str = json["LastUpdate"].as_str().unwrap_or("19000101T000000");
                // Orthanc format: "20240101T120000"
                let ts = parse_orthanc_timestamp(ts_str);
                studies_with_time.push((id.clone(), ts));
            }
        }
    }

    // Sort oldest first (LRU)
    studies_with_time.sort_by_key(|(_, ts)| *ts);

    let to_remove = studies_with_time.len() - max_studies;
    for (id, _) in studies_with_time.iter().take(to_remove) {
        tracing::info!("Cleanup: removing study {id} from Orthanc");
        if let Err(e) = orthanc::delete_study(id).await {
            tracing::warn!("Failed to delete study {id}: {e}");
        }
    }

    Ok(())
}

fn parse_orthanc_timestamp(s: &str) -> DateTime<Utc> {
    // Orthanc format: "20240315T143022"
    chrono::NaiveDateTime::parse_from_str(s, "%Y%m%dT%H%M%S")
        .map(|ndt| ndt.and_utc())
        .unwrap_or(DateTime::<Utc>::MIN_UTC)
}

fn load_cleanup_settings(app: &AppHandle) -> CleanupSettings {
    let path = match storage::get_settings_path(app) {
        Ok(p) => p,
        Err(_) => return CleanupSettings::default(),
    };

    if !path.exists() {
        return CleanupSettings::default();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return CleanupSettings::default(),
    };

    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return CleanupSettings::default(),
    };

    CleanupSettings {
        max_studies_in_orthanc: settings["orthanc"]["maxStudies"].as_u64().map(|v| v as usize),
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct CleanupSettings {
    max_studies_in_orthanc: Option<usize>,
}
