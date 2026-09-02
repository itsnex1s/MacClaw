//! Secrets live in the login Keychain as generic passwords under one service name.
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "ai.macclaw.panel";
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

pub fn read(account: &str) -> Result<Option<String>, String> {
    match get_generic_password(SERVICE, account) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|error| format!("Keychain item {account} is not UTF-8: {error}")),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(error) => Err(format!("Keychain read for {account} failed: {error}")),
    }
}

pub fn write(account: &str, value: &str) -> Result<(), String> {
    set_generic_password(SERVICE, account, value.as_bytes())
        .map_err(|error| format!("Keychain write for {account} failed: {error}"))
}

pub fn delete(account: &str) -> Result<(), String> {
    match delete_generic_password(SERVICE, account) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(format!("Keychain delete for {account} failed: {error}")),
    }
}
