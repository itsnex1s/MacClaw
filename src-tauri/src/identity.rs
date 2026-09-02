//! Ed25519 device identity for the gateway's signed connect challenge.
//!
//! The gateway derives the device id as the SHA-256 hex digest of the raw
//! public key and expects the public key and signature as unpadded base64url.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use security_framework::random::SecRandom;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};

use crate::secrets;

const DEVICE_KEY_ACCOUNT: &str = "device-key";

static SIGNING_KEY: OnceLock<Mutex<Option<SigningKey>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub device_id: String,
    pub public_key: String,
}

fn load_or_create_key() -> Result<SigningKey, String> {
    if let Some(stored) = secrets::read(DEVICE_KEY_ACCOUNT)? {
        let bytes = URL_SAFE_NO_PAD
            .decode(stored.trim())
            .map_err(|error| format!("stored device key is not base64url: {error}"))?;
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "stored device key has the wrong length".to_string())?;
        return Ok(SigningKey::from_bytes(&seed));
    }

    let mut seed = [0u8; 32];
    SecRandom::default()
        .copy_bytes(&mut seed)
        .map_err(|error| format!("random generator failed: {error}"))?;
    secrets::write(DEVICE_KEY_ACCOUNT, &URL_SAFE_NO_PAD.encode(seed))?;
    Ok(SigningKey::from_bytes(&seed))
}

fn with_key<T>(operation: impl FnOnce(&SigningKey) -> T) -> Result<T, String> {
    let cache = SIGNING_KEY.get_or_init(|| Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|error| format!("Lock error: {error}"))?;
    if guard.is_none() {
        *guard = Some(load_or_create_key()?);
    }
    Ok(operation(guard.as_ref().expect("key loaded above")))
}

pub fn identity_for(key: &SigningKey) -> DeviceIdentity {
    let public = key.verifying_key().to_bytes();
    let device_id = Sha256::digest(public)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    DeviceIdentity {
        device_id,
        public_key: URL_SAFE_NO_PAD.encode(public),
    }
}

#[tauri::command]
pub fn device_identity() -> Result<DeviceIdentity, String> {
    with_key(identity_for)
}

#[tauri::command]
pub fn sign_device_payload(payload: String) -> Result<String, String> {
    with_key(|key| URL_SAFE_NO_PAD.encode(key.sign(payload.as_bytes()).to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn device_id_is_sha256_hex_of_the_raw_public_key() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let identity = identity_for(&key);
        let raw = URL_SAFE_NO_PAD.decode(&identity.public_key).unwrap();
        let expected: String = Sha256::digest(&raw)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(raw.len(), 32);
        assert_eq!(identity.public_key.len(), 43);
        assert_eq!(identity.device_id, expected);
    }

    #[test]
    fn signature_is_base64url_and_verifies() {
        let key = SigningKey::from_bytes(&[9u8; 32]);
        let payload = "v3|device|webchat-ui|ui|operator|operator.read|1|token|nonce|darwin|";
        let signature = key.sign(payload.as_bytes());
        assert!(key
            .verifying_key()
            .verify(payload.as_bytes(), &signature)
            .is_ok());
        assert_eq!(URL_SAFE_NO_PAD.encode(signature.to_bytes()).len(), 86);
    }
}
