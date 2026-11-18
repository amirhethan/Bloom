// Anthropic API key storage. The key never lands in the database.
//  - Windows: Credential Manager through `keyring`.
//  - Android/iOS: a 0600 file inside the app's private data directory (no keychain crate there).

use std::path::Path;

#[cfg(desktop)]
use keyring::Entry;

const SERVICE: &str = "com.bloom.app";
const ACCOUNT: &str = "anthropic";

#[cfg(mobile)]
static KEY_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Called once at startup with the app data directory.
pub fn init(data_dir: &Path) {
    #[cfg(mobile)]
    {
        let _ = KEY_PATH.set(data_dir.join("ai.key"));
    }
    #[cfg(desktop)]
    let _ = data_dir;
}

#[cfg(desktop)]
fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain: {e}"))
}

#[cfg(desktop)]
pub fn get_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

#[cfg(desktop)]
pub fn set_key(key: &str) -> Result<(), String> {
    entry()?.set_password(key.trim()).map_err(|e| format!("keychain write: {e}"))
}

#[cfg(desktop)]
pub fn clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {e}")),
    }
}

#[cfg(mobile)]
fn key_file() -> Result<&'static std::path::PathBuf, String> {
    KEY_PATH.get().ok_or_else(|| "key storage not initialised".to_string())
}

#[cfg(mobile)]
pub fn get_key() -> Option<String> {
    let path = key_file().ok()?;
    std::fs::read_to_string(path).ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

#[cfg(mobile)]
pub fn set_key(key: &str) -> Result<(), String> {
    let path = key_file()?;
    std::fs::write(path, key.trim()).map_err(|e| format!("key write: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("key perms: {e}"))?;
    }
    Ok(())
}

#[cfg(mobile)]
pub fn clear_key() -> Result<(), String> {
    match key_file().and_then(|p| std::fs::remove_file(p).map_err(|e| e.to_string())) {
        Ok(()) => Ok(()),
        Err(e) if e.contains("not found") => Ok(()),
        Err(e) => Err(format!("key delete: {e}")),
    }
}
