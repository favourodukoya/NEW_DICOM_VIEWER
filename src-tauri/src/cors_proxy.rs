/// Local HTTP reverse-proxy that forwards requests to Orthanc with full CORS
/// support. This is needed because:
///   1. The production Tauri webview serves from https://tauri.localhost (or
///      http://tauri.localhost with dangerousUseHttpScheme).
///   2. Orthanc doesn't handle OPTIONS preflight → CORS fails for cross-origin.
///   3. The custom orthanc:// scheme has compatibility issues with XMLHttpRequest
///      in WebView2 (cornerstoneWADOImageLoader uses XHR for WADO-RS).
///
/// This proxy listens on 127.0.0.1:<random_port>, handles OPTIONS preflight,
/// and forwards everything else to Orthanc, injecting CORS headers on every response.

use crate::orthanc;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response};
use hyper_util::rt::TokioIo;
use once_cell::sync::Lazy;
use std::sync::RwLock;
use tokio::net::TcpListener;

static PROXY_PORT: Lazy<RwLock<u16>> = Lazy::new(|| RwLock::new(0));

pub fn get_proxy_port() -> u16 {
    *PROXY_PORT.read().unwrap()
}

/// Preferred port for the CORS proxy. The frontend config uses this constant
/// so that the DICOMweb data source URL is known at script-load time (before
/// any async Tauri IPC can resolve).
const PREFERRED_PORT: u16 = 18042;

/// Start the CORS proxy. Returns the port it's listening on.
/// Tries PREFERRED_PORT first; falls back to a random port if taken.
pub async fn start_cors_proxy() -> anyhow::Result<u16> {
    let listener = match TcpListener::bind(format!("127.0.0.1:{PREFERRED_PORT}")).await {
        Ok(l) => l,
        Err(_) => {
            tracing::warn!("Port {PREFERRED_PORT} is busy, using random port for CORS proxy");
            TcpListener::bind("127.0.0.1:0").await?
        }
    };
    let port = listener.local_addr()?.port();
    *PROXY_PORT.write().unwrap() = port;

    tracing::info!("CORS proxy listening on 127.0.0.1:{port}");

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let io = TokioIo::new(stream);
                    tokio::spawn(async move {
                        if let Err(e) = http1::Builder::new()
                            .keep_alive(true)
                            .serve_connection(io, service_fn(handle_request))
                            .await
                        {
                            // Connection reset / closed by client — not an error
                            if !e.is_incomplete_message() {
                                tracing::debug!("CORS proxy connection error: {e}");
                            }
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!("CORS proxy accept error: {e}");
                }
            }
        }
    });

    Ok(port)
}

fn cors_headers(builder: hyper::http::response::Builder) -> hyper::http::response::Builder {
    builder
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS, PATCH",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("Access-Control-Max-Age", "86400")
}

async fn handle_request(
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Box<dyn std::error::Error + Send + Sync>> {
    // Handle CORS preflight
    if req.method() == Method::OPTIONS {
        let resp = cors_headers(Response::builder())
            .status(204)
            .body(Full::new(Bytes::new()))?;
        return Ok(resp);
    }

    let orthanc_base = orthanc::get_orthanc_url();
    let path = req.uri().path();
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let target_url = format!("{}{}{}", orthanc_base, path, query);

    let method_str = req.method().as_str().to_string();

    // Collect incoming headers (skip hop-by-hop)
    let mut forward_headers = Vec::new();
    for (name, value) in req.headers() {
        let n = name.as_str().to_lowercase();
        if n != "host" && n != "origin" && n != "referer" && n != "connection" {
            forward_headers.push((name.clone(), value.clone()));
        }
    }

    // Read body
    let body_bytes = req.collect().await?.to_bytes();

    // Forward to Orthanc via reqwest
    let client = reqwest::Client::new();
    let reqwest_method =
        reqwest::Method::from_bytes(method_str.as_bytes()).unwrap_or(reqwest::Method::GET);

    let mut builder = client.request(reqwest_method, &target_url);
    for (name, value) in &forward_headers {
        builder = builder.header(name.as_str(), value.as_bytes());
    }
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes.to_vec());
    }

    match builder.send().await {
        Ok(orthanc_resp) => {
            let status = orthanc_resp.status().as_u16();
            let resp_headers = orthanc_resp.headers().clone();
            let resp_body = orthanc_resp.bytes().await.unwrap_or_default();

            let mut response = cors_headers(Response::builder()).status(status);

            // Forward Orthanc response headers (skip hop-by-hop and CORS — we add our own)
            for (name, value) in &resp_headers {
                let n = name.as_str().to_lowercase();
                if !n.starts_with("access-control-") && n != "connection" && n != "transfer-encoding"
                {
                    response = response.header(name, value);
                }
            }

            Ok(response.body(Full::new(Bytes::from(resp_body.to_vec())))?)
        }
        Err(e) => {
            tracing::error!("CORS proxy → Orthanc error: {e}");
            let resp = cors_headers(Response::builder())
                .status(502)
                .header("Content-Type", "text/plain")
                .body(Full::new(Bytes::from(
                    format!("Orthanc proxy error: {e}").into_bytes(),
                )))?;
            Ok(resp)
        }
    }
}
