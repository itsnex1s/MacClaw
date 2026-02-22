use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{Emitter, Manager};

pub const WINDOW_LABEL: &str = "main";
pub const COMPACT_WIDTH: f64 = 750.0;
pub const COMPACT_HEIGHT: f64 = 56.0;

pub static IS_PANEL_OPEN: AtomicBool = AtomicBool::new(false);
static CENTER_POS: OnceLock<(i32, i32)> = OnceLock::new();

/// Hide the panel. Size is NOT reset here — present_panel handles
/// the compact reset, while restore_panel preserves the current size.
/// Used by hide_panel command (Escape key) and hotkey toggle — NOT by
/// focus-loss, which goes through JS via the "panel-dismiss" event.
pub fn dismiss_panel(window: &tauri::WebviewWindow) {
    IS_PANEL_OPEN.store(false, Ordering::SeqCst);
    let _ = window.hide();
}

/// Show the panel at a fixed position and focus it.
/// First call: let macOS center the window, store the exact physical
/// coordinates. All subsequent calls: restore the stored position.
/// This eliminates drift from Dock auto-hide, screen changes, etc.
pub fn present_panel(window: &tauri::WebviewWindow) {
    IS_PANEL_OPEN.store(true, Ordering::SeqCst);
    let _ = window.set_size(tauri::Size::Logical(
        tauri::LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT),
    ));

    match CENTER_POS.get() {
        Some(&(x, y)) => {
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            ));
        }
        None => {
            // First open — let macOS compute the centered position.
            let _ = window.center();
        }
    }

    let _ = window.show();
    let _ = window.set_focus();

    // After the first visible show, store the position permanently.
    if CENTER_POS.get().is_none() {
        if let Ok(pos) = window.outer_position() {
            CENTER_POS.get_or_init(|| (pos.x, pos.y));
        }
    }

    let _ = window.emit("panel-show", "");
}

/// Show the panel without resetting size — used when restoring from notch
/// so the response content stays visible.
pub fn restore_panel(window: &tauri::WebviewWindow) {
    IS_PANEL_OPEN.store(true, Ordering::SeqCst);

    match CENTER_POS.get() {
        Some(&(x, y)) => {
            let _ = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            ));
        }
        None => {
            let _ = window.center();
        }
    }

    let _ = window.show();
    let _ = window.set_focus();

    if CENTER_POS.get().is_none() {
        if let Ok(pos) = window.outer_position() {
            CENTER_POS.get_or_init(|| (pos.x, pos.y));
        }
    }

    let _ = window.emit("panel-show", "");
}

#[tauri::command]
pub fn hide_panel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        dismiss_panel(&window);
    }
    Ok(())
}
