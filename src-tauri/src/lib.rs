mod commands;
mod cors_proxy;
mod orthanc;
mod security;
mod storage;
mod cleanup;

use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
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
        .plugin(tauri_plugin_deep_link::init())
        // ── Orthanc reverse proxy via custom URI scheme ──────────────────
        // Register "orthanc://" protocol that proxies all requests to the
        // local Orthanc instance. This completely bypasses CORS and mixed-
        // content restrictions in production (where the webview origin is
        // https://tauri.localhost or tauri://localhost).
        // Usage in JS: fetch('orthanc://localhost/dicom-web/studies/...')
        .register_asynchronous_uri_scheme_protocol("orthanc", |_ctx, request, responder| {
            tauri::async_runtime::spawn(async move {
                let orthanc_base = orthanc::get_orthanc_url(); // e.g. http://127.0.0.1:8042
                let uri = request.uri();
                let path = uri.path();
                let query_string = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
                let target_url = format!("{}{}{}", orthanc_base, path, query_string);

                let client = reqwest::Client::new();
                let method_str = request.method().as_str();
                let body_bytes = request.body().clone();

                // Build the outgoing request to Orthanc
                let mut builder = match method_str {
                    "GET" => client.get(&target_url),
                    "POST" => client.post(&target_url),
                    "PUT" => client.put(&target_url),
                    "DELETE" => client.delete(&target_url),
                    "OPTIONS" => {
                        // Respond to preflight directly — Orthanc may not handle OPTIONS
                        let resp = http::Response::builder()
                            .status(200)
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
                            .header("Access-Control-Allow-Headers", "*")
                            .header("Access-Control-Max-Age", "86400")
                            .body(Vec::new())
                            .unwrap();
                        responder.respond(resp);
                        return;
                    }
                    _ => client.request(
                        reqwest::Method::from_bytes(method_str.as_bytes()).unwrap_or(reqwest::Method::GET),
                        &target_url,
                    ),
                };

                // Forward relevant headers (skip host and origin — those are for the proxy)
                for (name, value) in request.headers() {
                    let n = name.as_str().to_lowercase();
                    if n != "host" && n != "origin" && n != "referer" {
                        builder = builder.header(name, value);
                    }
                }

                // Forward body for POST/PUT
                if !body_bytes.is_empty() {
                    builder = builder.body(body_bytes);
                }

                match builder.send().await {
                    Ok(orthanc_resp) => {
                        let status = orthanc_resp.status().as_u16();
                        let resp_headers = orthanc_resp.headers().clone();
                        let resp_body = orthanc_resp.bytes().await.unwrap_or_default();

                        let mut response = http::Response::builder().status(status);
                        // Forward Orthanc response headers
                        for (name, value) in &resp_headers {
                            response = response.header(name, value);
                        }
                        // Ensure CORS headers are present
                        response = response.header("Access-Control-Allow-Origin", "*");

                        let resp = response.body(resp_body.to_vec()).unwrap_or_else(|_| {
                            http::Response::builder()
                                .status(502)
                                .body(b"proxy response build error".to_vec())
                                .unwrap()
                        });
                        responder.respond(resp);
                    }
                    Err(e) => {
                        tracing::error!("Orthanc proxy error: {e}");
                        let resp = http::Response::builder()
                            .status(502)
                            .header("Content-Type", "text/plain")
                            .body(format!("Orthanc proxy error: {e}").into_bytes())
                            .unwrap();
                        responder.respond(resp);
                    }
                }
            });
        })
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

            // ── CORS reverse proxy ────────────────────────────────────────────────
            // Start a local HTTP proxy on a random port that forwards to Orthanc
            // with full CORS support. This is used in production instead of the
            // orthanc:// custom scheme because WebView2's XHR doesn't reliably
            // support custom URI schemes (cornerstoneWADOImageLoader uses XHR).
            // In dev mode the rsbuild proxy handles this, so the CORS proxy is
            // still started but the frontend won't use it.
            tauri::async_runtime::spawn(async {
                match cors_proxy::start_cors_proxy().await {
                    Ok(port) => tracing::info!("CORS proxy started on 127.0.0.1:{port}"),
                    Err(e) => tracing::error!("Failed to start CORS proxy: {e}"),
                }
            });

            // Start Orthanc sidecar process — only when the binary is actually bundled.
            // In dev mode (`cargo tauri dev`) Orthanc is assumed to be running externally.
            // In production, if no sidecar binary is present the app assumes Orthanc is
            // already running on the configured port (127.0.0.1:8042 by default).
            #[cfg(not(dev))]
            tauri::async_runtime::spawn(async move {
                match orthanc::start_orthanc(&app_handle).await {
                    Ok(()) => tracing::info!("Orthanc sidecar started successfully"),
                    Err(e) => {
                        tracing::warn!("Orthanc sidecar not started ({e}). Assuming external Orthanc is running on {}", orthanc::get_orthanc_url());
                        // Verify the external instance is reachable; log but don't panic.
                        if !orthanc::is_orthanc_running().await {
                            tracing::warn!("External Orthanc does not appear to be running at {}. Study list will be empty until Orthanc is started.", orthanc::get_orthanc_url());
                        }
                    }
                }
            });
            #[cfg(dev)]
            {
                let _ = app_handle; // suppress unused warning
                tracing::info!("Dev mode: expecting Orthanc to be running externally on {}", orthanc::get_orthanc_url());
            }

            // Start cleanup scheduler
            let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                cleanup::run_cleanup_scheduler(app_handle2).await;
            });

            // ── Deep link / "Open with" file association handler ──────────────
            // Fires when the app is opened by double-clicking a .dcm/.zip file
            // or via the ukubona:// URI scheme. We forward the paths to the
            // main window as a custom event so the JS side can upload them.
            let app_handle3 = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let paths: Vec<String> = event.urls().iter()
                    .map(|u| u.to_string())
                    .collect();
                if paths.is_empty() { return; }
                tracing::info!("Deep link opened with {} path(s)", paths.len());
                if let Some(window) = app_handle3.get_webview_window("main") {
                    let _ = window.emit("ukubona://open-files", &paths);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_studies,
            commands::import_study_to_orthanc,
            commands::delete_study_from_orthanc,
            commands::check_study_in_orthanc,
            commands::upload_dicom_files,
            commands::upload_dicom_paths,
            commands::upload_zip,
            commands::upload_folder,
            commands::save_report,
            commands::load_report,
            commands::list_reports,
            commands::get_settings,
            commands::save_settings,
            commands::get_orthanc_status,
            commands::get_orthanc_url,
            commands::get_cors_proxy_port,
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
            commands::list_optical_drives,
            commands::delete_study_by_uid,
            commands::get_settings_path_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
