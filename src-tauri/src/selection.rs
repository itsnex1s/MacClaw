use accessibility_sys::{
    error_string, kAXErrorAttributeUnsupported, kAXErrorNoValue, kAXErrorSuccess,
    kAXFocusedUIElementAttribute, kAXSelectedTextAttribute, kAXTrustedCheckOptionPrompt, AXError,
    AXIsProcessTrustedWithOptions, AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide,
    AXUIElementRef,
};
use core_foundation::{
    base::{CFType, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    string::CFString,
};
#[cfg(target_os = "macos")]
use core_graphics::{
    event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode},
    event_source::{CGEventSource, CGEventSourceStateID},
};
use serde::Serialize;
use std::{
    io::Write,
    process::{Command, Stdio},
    ptr, thread,
    time::{Duration, Instant},
};

pub const SELECTION_SHORTCUT: &str = "CmdOrCtrl+Shift+L";
pub const MAX_SELECTION_CHARS: usize = 12_000;
const CLIPBOARD_FALLBACK_WAIT_MS: u64 = 420;
const CLIPBOARD_FALLBACK_POLL_MS: u64 = 35;

const ACCESSIBILITY_PERMISSION_ERROR: &str = "Grant Accessibility permission to MacClaw and retry";
#[cfg(target_os = "macos")]
const KEYCODE_C: CGKeyCode = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionPrefillPayload {
    pub text: String,
    pub has_text: bool,
    pub error: Option<String>,
}

pub fn capture_selected_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        capture_selected_text_macos()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Selected text capture is available only on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
fn capture_selected_text_macos() -> Result<String, String> {
    ensure_accessibility_permission()?;

    let selected_text = capture_selected_text_via_accessibility()?;
    if !selected_text.is_empty() {
        return Ok(selected_text);
    }

    let fallback = match capture_selected_text_via_clipboard() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("clipboard fallback failed: {error}");
            String::new()
        }
    };

    Ok(normalize_selection_text(&fallback))
}

#[cfg(target_os = "macos")]
fn capture_selected_text_via_accessibility() -> Result<String, String> {
    let system_element = unsafe { AXUIElementCreateSystemWide() };
    if system_element.is_null() {
        return Ok(String::new());
    }
    let _system_guard = unsafe { CFType::wrap_under_create_rule(system_element as CFTypeRef) };

    let Some(focused_element) =
        copy_attribute_ui_element(system_element, kAXFocusedUIElementAttribute)?
    else {
        return Ok(String::new());
    };
    let _focused_guard = unsafe { CFType::wrap_under_create_rule(focused_element as CFTypeRef) };

    let Some(selected_text) = copy_attribute_string(focused_element, kAXSelectedTextAttribute)?
    else {
        return Ok(String::new());
    };

    Ok(normalize_selection_text(&selected_text))
}

#[cfg(target_os = "macos")]
fn capture_selected_text_via_clipboard() -> Result<String, String> {
    let previous_clipboard = read_clipboard_text().unwrap_or(None);

    let captured_result = (|| -> Result<String, String> {
        trigger_copy_shortcut()?;

        let wait_deadline = Instant::now() + Duration::from_millis(CLIPBOARD_FALLBACK_WAIT_MS);
        let mut latest = String::new();

        while Instant::now() < wait_deadline {
            latest = read_clipboard_text().unwrap_or(None).unwrap_or_default();
            let changed = match previous_clipboard.as_ref() {
                Some(previous_text) => latest != *previous_text,
                None => !latest.is_empty(),
            };
            if changed {
                break;
            }
            thread::sleep(Duration::from_millis(CLIPBOARD_FALLBACK_POLL_MS));
        }

        let captured = if latest.is_empty() {
            read_clipboard_text().unwrap_or(None).unwrap_or_default()
        } else {
            latest
        };

        let unchanged = previous_clipboard
            .as_ref()
            .is_some_and(|previous_text| captured == *previous_text);
        if captured.trim().is_empty() || unchanged {
            return Ok(String::new());
        }

        Ok(captured)
    })();

    if let Some(previous_text) = previous_clipboard {
        let _ = write_clipboard_text(&previous_text);
    }
    captured_result
}

#[cfg(target_os = "macos")]
fn trigger_copy_shortcut() -> Result<(), String> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "failed to create keyboard event source".to_string())?;

    let key_down = CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, true)
        .map_err(|_| "failed to create key-down event".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    thread::sleep(Duration::from_millis(10));

    let key_up = CGEvent::new_keyboard_event(source, KEYCODE_C, false)
        .map_err(|_| "failed to create key-up event".to_string())?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg(target_os = "macos")]
fn read_clipboard_text() -> Result<Option<String>, String> {
    let output = Command::new("/usr/bin/pbpaste")
        .output()
        .map_err(|error| format!("failed to read clipboard: {error}"))?;

    if output.status.success() {
        return Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()));
    }

    // No textual clipboard format (e.g. image/file) or empty clipboard.
    Ok(None)
}

#[cfg(target_os = "macos")]
fn write_clipboard_text(value: &str) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to spawn pbcopy: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(value.as_bytes())
            .map_err(|error| format!("failed to write clipboard: {error}"))?;
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed waiting pbcopy: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("pbcopy exited with non-zero status".to_string())
    }
}

#[cfg(target_os = "macos")]
fn ensure_accessibility_permission() -> Result<(), String> {
    let prompt_key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options: CFDictionary<CFString, CFBoolean> =
        CFDictionary::from_CFType_pairs(&[(prompt_key, CFBoolean::true_value())]);

    let trusted = unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    if trusted {
        Ok(())
    } else {
        Err(ACCESSIBILITY_PERMISSION_ERROR.to_string())
    }
}

#[cfg(target_os = "macos")]
fn copy_attribute_ui_element(
    element: AXUIElementRef,
    attribute: &'static str,
) -> Result<Option<AXUIElementRef>, String> {
    let Some(raw_value) = copy_attribute_value(element, attribute)? else {
        return Ok(None);
    };

    Ok(Some(raw_value as AXUIElementRef))
}

#[cfg(target_os = "macos")]
fn copy_attribute_string(
    element: AXUIElementRef,
    attribute: &'static str,
) -> Result<Option<String>, String> {
    let Some(raw_value) = copy_attribute_value(element, attribute)? else {
        return Ok(None);
    };

    let value = unsafe { CFType::wrap_under_create_rule(raw_value) };
    let Some(value_string) = value.downcast::<CFString>() else {
        return Ok(None);
    };

    Ok(Some(value_string.to_string()))
}

#[cfg(target_os = "macos")]
fn copy_attribute_value(
    element: AXUIElementRef,
    attribute: &'static str,
) -> Result<Option<CFTypeRef>, String> {
    let attribute_name = CFString::from_static_string(attribute);
    let mut value: CFTypeRef = ptr::null_mut();
    let error: AXError = unsafe {
        AXUIElementCopyAttributeValue(
            element,
            attribute_name.as_concrete_TypeRef(),
            &mut value as *mut CFTypeRef,
        )
    };

    if error == kAXErrorSuccess {
        if value.is_null() {
            return Ok(None);
        }
        return Ok(Some(value));
    }

    if error == kAXErrorNoValue || error == kAXErrorAttributeUnsupported {
        return Ok(None);
    }

    Err(format!("{} ({error})", error_string(error)))
}

fn normalize_selection_text(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.chars().count() <= MAX_SELECTION_CHARS {
        return trimmed.to_string();
    }

    trimmed.chars().take(MAX_SELECTION_CHARS).collect()
}
