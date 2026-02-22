use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

use crate::panel::{restore_panel, WINDOW_LABEL};

pub const NOTCH_LABEL: &str = "notch";

// Indicator width (logical points). Height is computed from menu bar + content.
const INDICATOR_WIDTH: f64 = 300.0;
const CONTENT_HEIGHT: f64 = 44.0;

pub static IS_BACKGROUND_RESPONSE: AtomicBool = AtomicBool::new(false);

/// Detect real notch dimensions from NSScreen APIs (macOS 12+).
/// Returns (width, height, scale_factor) in logical points, or None if no notch.
fn detect_notch() -> Option<(f64, f64, f64)> {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::MainThreadMarker;

    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;

    let insets = screen.safeAreaInsets();
    if insets.top <= 0.0 {
        return None;
    }

    let frame = screen.frame();
    let left = screen.auxiliaryTopLeftArea();
    let right = screen.auxiliaryTopRightArea();

    let notch_width = frame.size.width - left.size.width - right.size.width;
    let notch_height = insets.top;
    let scale = screen.backingScaleFactor();

    Some((notch_width, notch_height, scale))
}

#[tauri::command]
pub fn show_notch(app: tauri::AppHandle) -> Result<(), String> {
    IS_BACKGROUND_RESPONSE.store(true, Ordering::SeqCst);

    // Get menu bar height and scale factor (needed for both re-show and first create).
    let (menu_bar_h, scale) = detect_notch()
        .map(|(_w, h, s)| (h, s))
        .unwrap_or_else(|| {
            let s = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|m| m.scale_factor())
                .unwrap_or(2.0);
            (24.0, s)
        });

    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        // BUG 1: Reset DOM to streaming state before showing to avoid stale content flash.
        let _ = window.emit("notch-state", serde_json::json!({"state": "streaming"}));
        // BUG 4: Sync CSS spacer height with real menu bar height.
        let _ = window.eval(&format!(
            "document.documentElement.style.setProperty('--menu-bar-h','{}px')",
            menu_bar_h
        ));
        let _ = window.show();
        return Ok(());
    }

    // Total height: menu bar (blends with notch) + visible content below.
    let total_height = menu_bar_h + CONTENT_HEIGHT;

    let notch_window = tauri::WebviewWindowBuilder::new(
        &app,
        NOTCH_LABEL,
        tauri::WebviewUrl::App("notch.html".into()),
    )
    .title("Notch")
    .inner_size(INDICATOR_WIDTH, total_height)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| format!("Failed to create notch window: {e}"))?;

    // Position at y=0, centered — top portion blends with hardware notch,
    // bottom portion extends below the menu bar with visible content.
    let phys_w = (INDICATOR_WIDTH * scale) as i32;
    if let Some(monitor) = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
    {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let x = monitor_pos.x + (monitor_size.width as i32 - phys_w) / 2;
        let y = monitor_pos.y;
        let _ = notch_window.set_position(tauri::Position::Physical(
            tauri::PhysicalPosition::new(x, y),
        ));
    }

    let _ = notch_window.show();

    // BUG 4: Sync CSS spacer height with real menu bar height.
    let _ = notch_window.eval(&format!(
        "document.documentElement.style.setProperty('--menu-bar-h','{}px')",
        menu_bar_h
    ));

    // Float above menu bar (level 25) and remove window shadow/border.
    configure_notch_window(&notch_window);

    Ok(())
}

/// Configure NSWindow: status-level (25) + no shadow for seamless notch blend.
fn configure_notch_window(window: &tauri::WebviewWindow) {
    use raw_window_handle::HasWindowHandle;
    let Ok(handle) = window.window_handle() else { return };
    let raw_window_handle::RawWindowHandle::AppKit(appkit) = handle.as_raw() else { return };
    unsafe {
        let ns_view = appkit.ns_view.as_ptr() as *mut objc2::runtime::AnyObject;
        let ns_window: *mut objc2::runtime::AnyObject =
            objc2::msg_send![ns_view, window];
        if !ns_window.is_null() {
            let _: () = objc2::msg_send![ns_window, setLevel: 25_i64];
            let _: () = objc2::msg_send![ns_window, setHasShadow: false];
        }
    }
}

#[tauri::command]
pub fn hide_notch(app: tauri::AppHandle) -> Result<(), String> {
    IS_BACKGROUND_RESPONSE.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn notch_clicked(app: tauri::AppHandle) -> Result<(), String> {
    IS_BACKGROUND_RESPONSE.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        let _ = window.hide();
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.emit("notch-restore", "");
        restore_panel(&window);
    }
    Ok(())
}
