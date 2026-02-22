use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

const CREDS_FILE: &str = "credentials.json";

static CREDS_CACHE: OnceLock<Mutex<Credentials>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub gateway_url: String,
    pub token: String,
    pub password: String,
    pub agent_id: String,
    pub session_key: String,
    #[serde(default)]
    pub shortcuts: Option<Vec<String>>,
}

impl Default for Credentials {
    fn default() -> Self {
        Self {
            gateway_url: "ws://127.0.0.1:19819".into(),
            token: String::new(),
            password: String::new(),
            agent_id: String::new(),
            session_key: "main".into(),
            shortcuts: None,
        }
    }
}

fn creds_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("ai.macclaw.panel")
        .join(CREDS_FILE)
}

fn read_creds_file() -> Credentials {
    let path = creds_path();
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str::<Credentials>(&json).unwrap_or_default(),
        Err(_) => Credentials::default(),
    }
}

#[tauri::command]
pub fn load_credentials() -> Result<Credentials, String> {
    let cache = CREDS_CACHE.get_or_init(|| Mutex::new(read_creds_file()));
    let guard = cache.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn save_credentials(creds: Credentials) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&creds)
        .map_err(|error| format!("Serialize error: {error}"))?;
    let path = creds_path();
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("failed to create config dir: {e}");
        }
    }
    std::fs::write(&path, json).map_err(|error| format!("Write error: {error}"))?;

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
        if let Err(e) = std::fs::remove_file(&path) {
            eprintln!("failed to remove credentials file: {e}");
        }
    }

    let cache = CREDS_CACHE.get_or_init(|| Mutex::new(Credentials::default()));
    if let Ok(mut guard) = cache.lock() {
        *guard = Credentials::default();
    }
    Ok(())
}
