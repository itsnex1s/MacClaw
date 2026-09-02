use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

use crate::secrets;

const CREDS_FILE: &str = "credentials.json";
const TOKEN_ACCOUNT: &str = "gateway-token";
const PASSWORD_ACCOUNT: &str = "gateway-password";
pub const DEFAULT_GATEWAY_URL: &str = "ws://127.0.0.1:18789";

static CREDS_CACHE: OnceLock<Mutex<Credentials>> = OnceLock::new();

/// Settings as exchanged with the UI. The token and password come from the
/// Keychain; the JSON file on disk only ever holds the non-secret fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub gateway_url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub password: String,
    pub agent_id: String,
    pub session_key: String,
    #[serde(default)]
    pub shortcuts: Option<Vec<String>>,
}

impl Default for Credentials {
    fn default() -> Self {
        Self {
            gateway_url: DEFAULT_GATEWAY_URL.into(),
            token: String::new(),
            password: String::new(),
            agent_id: String::new(),
            session_key: "main".into(),
            shortcuts: None,
        }
    }
}

impl Credentials {
    fn without_secrets(&self) -> Self {
        Self {
            token: String::new(),
            password: String::new(),
            ..self.clone()
        }
    }
}

/// Device token issued by the gateway after pairing, with the scopes it was granted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceTokenRecord {
    pub token: String,
    pub scopes: Vec<String>,
}

fn creds_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ai.macclaw.panel")
        .join(CREDS_FILE)
}

fn write_creds_file(creds: &Credentials) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&creds.without_secrets())
        .map_err(|error| format!("Serialize error: {error}"))?;
    let path = creds_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| format!("Config dir error: {error}"))?;
    }
    std::fs::write(&path, json).map_err(|error| format!("Write error: {error}"))
}

fn read_secret(account: &str) -> String {
    match secrets::read(account) {
        Ok(value) => value.unwrap_or_default(),
        Err(error) => {
            eprintln!("{error}");
            String::new()
        }
    }
}

fn store_secret(account: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        secrets::delete(account)
    } else {
        secrets::write(account, value)
    }
}

/// Read the settings file, moving any secrets left over from older versions
/// (which stored them in plain text) into the Keychain.
fn read_creds_file() -> Credentials {
    let path = creds_path();
    let mut creds = match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str::<Credentials>(&json).unwrap_or_default(),
        Err(_) => Credentials::default(),
    };

    if !creds.token.is_empty() || !creds.password.is_empty() {
        let migrated = store_secret(TOKEN_ACCOUNT, &creds.token)
            .and_then(|_| store_secret(PASSWORD_ACCOUNT, &creds.password))
            .and_then(|_| write_creds_file(&creds));
        if let Err(error) = migrated {
            eprintln!("failed to move credentials into the Keychain: {error}");
            return creds;
        }
    }

    creds.token = read_secret(TOKEN_ACCOUNT);
    creds.password = read_secret(PASSWORD_ACCOUNT);
    creds
}

#[tauri::command]
pub fn load_credentials() -> Result<Credentials, String> {
    let cache = CREDS_CACHE.get_or_init(|| Mutex::new(read_creds_file()));
    let guard = cache
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn save_credentials(creds: Credentials) -> Result<(), String> {
    write_creds_file(&creds)?;
    store_secret(TOKEN_ACCOUNT, &creds.token)?;
    store_secret(PASSWORD_ACCOUNT, &creds.password)?;

    let cache = CREDS_CACHE.get_or_init(|| Mutex::new(Credentials::default()));
    if let Ok(mut guard) = cache.lock() {
        *guard = creds;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_credentials() -> Result<(), String> {
    let path = creds_path();
    if path.exists() {
        if let Err(error) = std::fs::remove_file(&path) {
            eprintln!("failed to remove credentials file: {error}");
        }
    }
    secrets::delete(TOKEN_ACCOUNT)?;
    secrets::delete(PASSWORD_ACCOUNT)?;

    let cache = CREDS_CACHE.get_or_init(|| Mutex::new(Credentials::default()));
    if let Ok(mut guard) = cache.lock() {
        *guard = Credentials::default();
    }
    Ok(())
}

fn device_token_account(gateway_url: &str) -> String {
    format!(
        "device-token:{}",
        gateway_url.trim().trim_end_matches('/').to_lowercase()
    )
}

#[tauri::command]
pub fn load_device_token(gateway_url: String) -> Result<Option<DeviceTokenRecord>, String> {
    match secrets::read(&device_token_account(&gateway_url))? {
        Some(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|error| format!("stored device token is invalid: {error}")),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn save_device_token(gateway_url: String, record: DeviceTokenRecord) -> Result<(), String> {
    let json =
        serde_json::to_string(&record).map_err(|error| format!("Serialize error: {error}"))?;
    secrets::write(&device_token_account(&gateway_url), &json)
}

#[tauri::command]
pub fn clear_device_token(gateway_url: String) -> Result<(), String> {
    secrets::delete(&device_token_account(&gateway_url))
}
