//! Security module: authentication, encryption, device fingerprint, secure report storage.
//!
//! - Passwords: Argon2id hash (never stored plaintext)
//! - Reports: AES-256-GCM per-user encryption (key derived from user master key)
//! - Sessions: persisted across app restarts, master key encrypted with device-bound key
//! - Device ID: Windows MachineGuid (fallback: hostname-based)

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit},
    Aes256Gcm,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use chrono::{TimeZone, Utc};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_TTL_SECS: i64 = 30 * 24 * 3600; // 30 days

// ─── In-Memory Session Store ─────────────────────────────────────────────────

struct SessionData {
    username: String,
    master_key: [u8; 32],
    expires_at: i64, // unix timestamp
}

static SESSIONS: Lazy<Mutex<HashMap<String, SessionData>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ─── Public Types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub token: String,
    pub username: String,
    pub device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub valid: bool,
    pub username: String,
}

// ─── Database ────────────────────────────────────────────────────────────────

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ukubona_auth.db"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(db_path(app)?).map_err(|e| e.to_string())
}

/// Initialize the security database. Called once at app startup.
pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS users (
            username       TEXT PRIMARY KEY,
            password_hash  TEXT NOT NULL,
            enc_master_key BLOB NOT NULL,
            mk_nonce       BLOB NOT NULL,
            mk_salt        BLOB NOT NULL,
            created_at     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token          TEXT PRIMARY KEY,
            username       TEXT NOT NULL,
            enc_master_key BLOB NOT NULL,
            mk_nonce       BLOB NOT NULL,
            expires_at     TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reports (
            username   TEXT NOT NULL,
            study_uid  TEXT NOT NULL,
            enc_data   BLOB NOT NULL,
            nonce      BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (username, study_uid)
        );
        CREATE TABLE IF NOT EXISTS device_info (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;

    // Seed default admin user if no users exist
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count == 0 {
        create_user_internal(&conn, "admin", "admin")?;
        tracing::info!("Created default admin user");
    }

    // Ensure device ID is stored
    ensure_device_id(&conn)?;

    Ok(())
}

/// Restore persisted sessions from the database into the in-memory store.
pub fn restore_sessions(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    let device_key = get_device_key();
    let now_str = Utc::now().to_rfc3339();

    // Purge expired sessions
    conn.execute("DELETE FROM sessions WHERE expires_at < ?1", params![now_str])
        .map_err(|e| e.to_string())?;

    // Load remaining valid sessions
    let mut stmt = conn
        .prepare("SELECT token, username, enc_master_key, mk_nonce, expires_at FROM sessions")
        .map_err(|e| e.to_string())?;

    let rows: Vec<_> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut sessions = SESSIONS.lock().map_err(|e| e.to_string())?;

    for (token, username, enc_mk, nonce_vec, expires_str) in rows {
        if nonce_vec.len() != 12 {
            continue;
        }
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&nonce_vec);

        if let Ok(mk_vec) = decrypt_bytes(&enc_mk, &nonce, &device_key) {
            if mk_vec.len() == 32 {
                let mut master_key = [0u8; 32];
                master_key.copy_from_slice(&mk_vec);
                let expires_at = chrono::DateTime::parse_from_rfc3339(&expires_str)
                    .map(|dt| dt.timestamp())
                    .unwrap_or(0);
                sessions.insert(
                    token,
                    SessionData {
                        username,
                        master_key,
                        expires_at,
                    },
                );
            }
        }
    }

    tracing::info!("Restored {} persistent sessions", sessions.len());
    Ok(())
}

// ─── Password Hashing (Argon2id) ────────────────────────────────────────────

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

fn verify_password(password: &str, hash_str: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash_str).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ─── Encryption (AES-256-GCM) ───────────────────────────────────────────────

/// Derive a 256-bit key from a password and salt using Argon2.
fn derive_key_from_password(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// Encrypt data with AES-256-GCM. Returns (ciphertext, 12-byte nonce).
fn encrypt_bytes(data: &[u8], key: &[u8; 32]) -> Result<(Vec<u8>, [u8; 12]), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(nonce.as_slice());
    Ok((ciphertext, nonce_bytes))
}

/// Decrypt data with AES-256-GCM.
fn decrypt_bytes(ciphertext: &[u8], nonce_bytes: &[u8; 12], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = aes_gcm::aead::generic_array::GenericArray::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())
}

// ─── Device Key & ID ─────────────────────────────────────────────────────────

/// Read the Windows MachineGuid from the registry, or fall back to hostname.
fn get_machine_fingerprint() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(guid) = text
                .lines()
                .find(|l| l.contains("MachineGuid"))
                .and_then(|l| l.split_whitespace().last())
            {
                return guid.to_string();
            }
        }
    }
    // Fallback: environment-based hostname
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "ukubona-fallback-device".to_string())
}

/// Derive a 256-bit device-specific encryption key. Never stored — always re-derived
/// from the machine fingerprint at runtime. Used to encrypt session master keys on disk.
fn get_device_key() -> [u8; 32] {
    let fp = get_machine_fingerprint();
    let mut h = Sha256::new();
    h.update(b"ukubona-device-encryption-key-v1:");
    h.update(fp.as_bytes());
    h.finalize().into()
}

/// Store the device ID in the database (for future server integration).
fn ensure_device_id(conn: &Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM device_info WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !exists {
        let device_id = get_machine_fingerprint();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO device_info (key, value) VALUES ('device_id', ?1)",
            params![device_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO device_info (key, value) VALUES ('device_created_at', ?1)",
            params![now],
        )
        .map_err(|e| e.to_string())?;
        tracing::info!("Device ID stored: {device_id}");
    }

    Ok(())
}

/// Get the stored device ID (public, for Tauri commands).
pub fn get_device_id(app: &AppHandle) -> Result<String, String> {
    let conn = open_db(app)?;
    conn.query_row(
        "SELECT value FROM device_info WHERE key = 'device_id'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())
}

// ─── User Management ─────────────────────────────────────────────────────────

fn create_user_internal(conn: &Connection, username: &str, password: &str) -> Result<(), String> {
    let pw_hash = hash_password(password)?;

    // Generate random 256-bit master encryption key for this user
    let mut master_key = [0u8; 32];
    OsRng.fill_bytes(&mut master_key);

    // Derive wrapping key from password to encrypt the master key
    let mut mk_salt = [0u8; 16];
    OsRng.fill_bytes(&mut mk_salt);
    let wrapping_key = derive_key_from_password(password, &mk_salt)?;

    // Encrypt master key with wrapping key
    let (enc_mk, mk_nonce) = encrypt_bytes(&master_key, &wrapping_key)?;

    conn.execute(
        "INSERT INTO users (username, password_hash, enc_master_key, mk_nonce, mk_salt, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            username,
            pw_hash,
            enc_mk,
            mk_nonce.to_vec(),
            mk_salt.to_vec(),
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ─── Authentication ──────────────────────────────────────────────────────────

/// Authenticate a user with username/password. Returns a session token, username, and device ID.
pub fn authenticate(
    app: &AppHandle,
    username: &str,
    password: &str,
) -> Result<AuthResult, String> {
    let conn = open_db(app)?;

    // Look up user record
    let (pw_hash, enc_mk, mk_nonce_vec, mk_salt): (String, Vec<u8>, Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT password_hash, enc_master_key, mk_nonce, mk_salt FROM users WHERE username = ?1",
            params![username],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            },
        )
        .map_err(|_| "Invalid username or password".to_string())?;

    // Verify password against stored Argon2 hash
    if !verify_password(password, &pw_hash)? {
        return Err("Invalid username or password".to_string());
    }

    // Decrypt user's master encryption key using password-derived wrapping key
    let wrapping_key = derive_key_from_password(password, &mk_salt)?;
    if mk_nonce_vec.len() != 12 {
        return Err("Corrupted user key data".to_string());
    }
    let mut mk_nonce = [0u8; 12];
    mk_nonce.copy_from_slice(&mk_nonce_vec);
    let mk_vec = decrypt_bytes(&enc_mk, &mk_nonce, &wrapping_key)?;
    if mk_vec.len() != 32 {
        return Err("Corrupted master key".to_string());
    }
    let mut master_key = [0u8; 32];
    master_key.copy_from_slice(&mk_vec);

    // Generate random session token
    let mut token_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut token_bytes);
    let token = hex::encode(token_bytes);

    let now = Utc::now().timestamp();
    let expires_at = now + SESSION_TTL_SECS;

    // Persist session to DB (master key encrypted with device-specific key)
    let device_key = get_device_key();
    let (enc_mk_session, session_nonce) = encrypt_bytes(&master_key, &device_key)?;
    let expires_str = Utc
        .timestamp_opt(expires_at, 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO sessions (token, username, enc_master_key, mk_nonce, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            token,
            username,
            enc_mk_session,
            session_nonce.to_vec(),
            expires_str
        ],
    )
    .map_err(|e| e.to_string())?;

    // Store in memory for fast validation
    SESSIONS.lock().map_err(|e| e.to_string())?.insert(
        token.clone(),
        SessionData {
            username: username.to_string(),
            master_key,
            expires_at,
        },
    );

    let device_id = conn
        .query_row(
            "SELECT value FROM device_info WHERE key = 'device_id'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_default();

    tracing::info!("User '{username}' authenticated successfully");

    Ok(AuthResult {
        token,
        username: username.to_string(),
        device_id,
    })
}

/// Check if a session token is valid and return the associated username.
pub fn validate_session(token: &str) -> Result<SessionInfo, String> {
    let sessions = SESSIONS.lock().map_err(|e| e.to_string())?;
    match sessions.get(token) {
        Some(s) if Utc::now().timestamp() <= s.expires_at => Ok(SessionInfo {
            valid: true,
            username: s.username.clone(),
        }),
        _ => Ok(SessionInfo {
            valid: false,
            username: String::new(),
        }),
    }
}

/// Invalidate a session (logout). Removes from both memory and database.
pub fn invalidate_session(app: &AppHandle, token: &str) -> Result<(), String> {
    // Remove from memory
    SESSIONS.lock().map_err(|e| e.to_string())?.remove(token);
    // Remove from database
    let conn = open_db(app)?;
    conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Internal: get the username and master key for a valid session.
fn get_session_key(token: &str) -> Result<(String, [u8; 32]), String> {
    let sessions = SESSIONS.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(token)
        .ok_or_else(|| "Invalid or expired session".to_string())?;
    if Utc::now().timestamp() > session.expires_at {
        return Err("Session expired".to_string());
    }
    Ok((session.username.clone(), session.master_key))
}

// ─── Secure Report Storage ───────────────────────────────────────────────────

/// Save a report (encrypted) for the authenticated user.
pub fn save_report_secure(
    app: &AppHandle,
    token: &str,
    study_uid: &str,
    report_json: &str,
) -> Result<(), String> {
    let (username, master_key) = get_session_key(token)?;
    let conn = open_db(app)?;

    let (enc_data, nonce) = encrypt_bytes(report_json.as_bytes(), &master_key)?;
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO reports (username, study_uid, enc_data, nonce, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(username, study_uid) DO UPDATE SET enc_data = ?3, nonce = ?4, updated_at = ?5",
        params![username, study_uid, enc_data, nonce.to_vec(), now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Load a report (decrypted) for the authenticated user.
pub fn load_report_secure(
    app: &AppHandle,
    token: &str,
    study_uid: &str,
) -> Result<Option<String>, String> {
    let (username, master_key) = get_session_key(token)?;
    let conn = open_db(app)?;

    let result = conn.query_row(
        "SELECT enc_data, nonce FROM reports WHERE username = ?1 AND study_uid = ?2",
        params![username, study_uid],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
    );

    match result {
        Ok((enc_data, nonce_vec)) => {
            if nonce_vec.len() != 12 {
                return Err("Corrupted report nonce".to_string());
            }
            let mut nonce = [0u8; 12];
            nonce.copy_from_slice(&nonce_vec);
            let plaintext = decrypt_bytes(&enc_data, &nonce, &master_key)?;
            String::from_utf8(plaintext)
                .map(Some)
                .map_err(|e| e.to_string())
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// List all study UIDs that have reports for the authenticated user.
pub fn list_reports_secure(app: &AppHandle, token: &str) -> Result<Vec<String>, String> {
    let (username, _) = get_session_key(token)?;
    let conn = open_db(app)?;

    let mut stmt = conn
        .prepare("SELECT study_uid FROM reports WHERE username = ?1")
        .map_err(|e| e.to_string())?;

    let uids: Vec<String> = stmt
        .query_map(params![username], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(uids)
}
