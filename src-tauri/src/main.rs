#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod credentials;
mod notch;
mod panel;
mod selection;

use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

use credentials::{clear_credentials, load_credentials, save_credentials};
use notch::{hide_notch, notch_clicked, show_notch, IS_BACKGROUND_RESPONSE, NOTCH_LABEL};
use panel::{dismiss_panel, hide_panel, present_panel, restore_panel, IS_PANEL_OPEN, WINDOW_LABEL};
use selection::{capture_selected_text, SelectionPrefillPayload, SELECTION_SHORTCUT};

const DEFAULT_SHORTCUTS: [&str; 3] = [
    "CmdOrCtrl+Shift+Space",
    "CmdOrCtrl+Shift+K",
    "Alt+Space",
];

fn handle_shortcut(app: &AppHandle) {
    // If a background response is active, restore from notch.
    if IS_BACKGROUND_RESPONSE.load(Ordering::SeqCst) {
        IS_BACKGROUND_RESPONSE.store(false, Ordering::SeqCst);
        if let Some(notch) = app.get_webview_window(NOTCH_LABEL) {
            let _ = notch.hide();
        }
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            let _ = window.emit("notch-restore", "");
            restore_panel(&window);
        }
        return;
    }

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if IS_PANEL_OPEN.load(Ordering::SeqCst) {
            dismiss_panel(&window);
        } else {
            present_panel(&window);
        }
    }
}

fn handle_selection_shortcut(app: &AppHandle) {
    // Any explicit selection capture restores the main panel and disables
    // background/notch mode to keep interaction deterministic.
    if IS_BACKGROUND_RESPONSE.load(Ordering::SeqCst) {
        IS_BACKGROUND_RESPONSE.store(false, Ordering::SeqCst);
        if let Some(notch) = app.get_webview_window(NOTCH_LABEL) {
            let _ = notch.hide();
        }
    }

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let (text, error) = match capture_selected_text() {
            Ok(text) => (text, None),
            Err(error) => (String::new(), Some(error)),
        };

        let payload = SelectionPrefillPayload {
            has_text: !text.is_empty(),
            text,
            error,
        };

        present_panel(&window);
        let _ = window.emit("panel-prefill-selection", payload);
    }
}

fn register_shortcuts(app: &AppHandle, shortcut_strs: &[&str]) {
    let gsm = app.global_shortcut();
    let _ = gsm.unregister_all();

    let mut parsed: Vec<Shortcut> = shortcut_strs
        .iter()
        .filter_map(|s| s.parse::<Shortcut>().ok())
        .collect();

    let selection_shortcut = SELECTION_SHORTCUT.parse::<Shortcut>().ok();
    if let Some(ref selection) = selection_shortcut {
        let selection_str = selection.to_string();
        let duplicate = parsed
            .iter()
            .any(|candidate| candidate.to_string() == selection_str);
        if !duplicate {
            parsed.push(*selection);
        }
    }
    let selection_shortcut_str = selection_shortcut.as_ref().map(ToString::to_string);

    if let Err(error) = gsm.on_shortcuts(parsed, move |app, shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(expected) = selection_shortcut_str.as_deref() {
                if shortcut.to_string() == expected {
                    handle_selection_shortcut(app);
                    return;
                }
            }
            handle_shortcut(app);
        }
    }) {
        eprintln!("failed to register global shortcuts: {error}");
    }
}

#[tauri::command]
fn update_shortcuts(app: AppHandle, shortcuts: Vec<String>) -> Result<(), String> {
    if shortcuts.len() != 3 {
        return Err("Exactly 3 shortcuts are required".into());
    }

    let refs: Vec<&str> = shortcuts.iter().map(|s| s.as_str()).collect();
    register_shortcuts(&app, &refs);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_credentials,
            save_credentials,
            clear_credentials,
            hide_panel,
            show_notch,
            hide_notch,
            notch_clicked,
            update_shortcuts
        ])
        .setup(move |app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Load saved shortcuts or fall back to defaults.
            let saved = credentials::load_credentials().ok();
            let saved_shortcuts = saved.and_then(|c| c.shortcuts);

            if let Some(ref custom) = saved_shortcuts {
                let refs: Vec<&str> = custom.iter().map(|s| s.as_str()).collect();
                register_shortcuts(app.handle(), &refs);
            } else {
                register_shortcuts(app.handle(), &DEFAULT_SHORTCUTS);
            }

            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                if let Err(error) = apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    Some(NSVisualEffectState::Active),
                    Some(12.0),
                ) {
                    eprintln!("failed to apply vibrancy: {error}");
                }

                // Window starts hidden (visible: false in tauri.conf.json).
                // present_panel() will center + show when hotkey is pressed.

                // On focus loss: notify JS but do NOT hide yet. JS handles
                // background-mode detection via the "panel-dismiss" event,
                // then calls hide_panel itself. Hiding here (orderOut:)
                // would suppress the DOM blur and IPC delivery.
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        if IS_PANEL_OPEN.load(Ordering::SeqCst) {
                            IS_PANEL_OPEN.store(false, Ordering::SeqCst);
                            let _ = window_clone.emit("panel-dismiss", "");
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
