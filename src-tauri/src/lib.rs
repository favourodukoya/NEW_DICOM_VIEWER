mod commands;
mod orthanc;
mod security;
mod storage;
mod cleanup;

use tauri::Manager;
use tracing_subscriber;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize security database and restore persistent sessions
            if let Err(e) = security::init_db(&app_handle) {
                tracing::error!("Failed to initialize security database: {e}");
                panic!("Security initialization failed: {e}");
            }
            if let Err(e) = security::restore_sessions(&app_handle) {
                tracing::warn!("Failed to restore sessions (users will re-login): {e}");
            }

            // Apply saved Orthanc URL from settings before starting the sidecar
            if let Ok(path) = app.handle().path().app_data_dir().map(|d| d.join("settings.json")) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(settings) = serde_json::from_str::<commands::AppSettings>(&content) {
                        if let (Some(host), Some(port)) = (&settings.orthanc.host, settings.orthanc.port) {
                            orthanc::set_orthanc_url(host, port);
                        }
                    }
                }
            }

            // Start Orthanc sidecar process.
            // In dev mode (`cargo tauri dev`) Orthanc is assumed to be running externally.
            // In a production bundle Orthanc is shipped as a sidecar binary and started here.
            #[cfg(not(dev))]
            tauri::async_runtime::spawn(async move {
                if let Err(e) = orthanc::start_orthanc(&app_handle).await {
                    tracing::error!("Failed to start Orthanc: {e}");
                }
            });
            #[cfg(dev)]
            {
                let _ = app_handle; // suppress unused warning
                tracing::info!("Dev mode: expecting Orthanc to be running externally on port 8042");
            }

            // Start cleanup scheduler
            let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                cleanup::run_cleanup_scheduler(app_handle2).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_studies,
            commands::import_study_to_orthanc,
            commands::delete_study_from_orthanc,
            commands::check_study_in_orthanc,
            commands::upload_dicom_files,
            commands::upload_zip,
            commands::upload_folder,
            commands::save_report,
            commands::load_report,
            commands::list_reports,
            commands::get_settings,
            commands::save_settings,
            commands::get_orthanc_status,
            commands::get_orthanc_url,
            commands::run_cleanup,
            commands::query_pacs,
            commands::retrieve_from_pacs,
            commands::get_storage_stats,
            commands::open_file_dialog,
            commands::open_folder_dialog,
            commands::authenticate,
            commands::validate_session,
            commands::logout_session,
            commands::get_device_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
