use eyre::{eyre, Result};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};

use crate::error::LogError;

/// Menu labels in the app's language, handed over by the frontend.
#[derive(Debug, Deserialize)]
pub struct TrayLabels {
    pub show: String,
    pub hide: String,
    pub quit: String,
    pub stop: String,
}

/// Holds the icon so it lives as long as the app, and so it can be dropped to remove the tray.
#[derive(Default)]
pub struct TrayState(Mutex<Option<TrayIcon>>);

fn recording_icon() -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as i32 - 16;
            let dy = y as i32 - 16;
            let color = if (12..20).contains(&x) && (12..20).contains(&y) {
                [255, 255, 255, 255]
            } else if dx * dx + dy * dy <= 14 * 14 {
                [220, 38, 38, 255]
            } else {
                [0, 0, 0, 0]
            };
            rgba.extend_from_slice(&color);
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    window.unminimize().map_err(|error| eyre!("{error:?}")).log_error();
    window.show().map_err(|error| eyre!("{error:?}")).log_error();
    window.set_focus().map_err(|error| eyre!("{error:?}")).log_error();
}

fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    window.hide().map_err(|error| eyre!("{error:?}")).log_error();
}

pub fn apply(app: &AppHandle, enabled: bool, recording: bool, labels: TrayLabels) -> Result<()> {
    let state = app.state::<TrayState>();
    let mut current = state.0.lock().map_err(|error| eyre!("tray state poisoned: {error}"))?;

    if !enabled && !recording {
        // Dropping the icon removes it from the menu bar / notification area.
        *current = None;
        return Ok(());
    }

    let show = MenuItemBuilder::with_id("show", labels.show).build(app)?;
    let hide = MenuItemBuilder::with_id("hide", labels.hide).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", labels.quit).build(app)?;
    let stop = MenuItemBuilder::with_id("stop-recording", &labels.stop).build(app)?;
    let menu = if recording && enabled {
        MenuBuilder::new(app).items(&[&stop, &show, &hide]).build()?
    } else if recording {
        MenuBuilder::new(app).items(&[&stop, &show]).build()?
    } else {
        MenuBuilder::new(app).items(&[&show, &hide, &quit]).build()?
    };

    if let Some(tray) = current.as_ref() {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(if recording { labels.stop.as_str() } else { "Vibe" }))?;
        let icon = if recording {
            recording_icon()
        } else {
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| eyre!("the app has no icon to put in the tray"))?
        };
        tray.set_icon(Some(icon))?;
        if cfg!(target_os = "macos") {
            tray.set_icon_as_template(false)?;
        }
        return Ok(());
    }

    let icon = if recording {
        recording_icon()
    } else {
        app.default_window_icon()
            .cloned()
            .ok_or_else(|| eyre!("the app has no icon to put in the tray"))?
    };
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(if recording { labels.stop.as_str() } else { "Vibe" })
        .menu(&menu)
        // macOS puts the menu on a left click; Windows and Linux expect it to open the window.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if cfg!(target_os = "macos") {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "stop-recording" => {
                app.emit("tray-stop-recording", ())
                    .map_err(|error| eyre!("{error:?}"))
                    .log_error();
            }
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            // Exit rather than close the window: the window's close handler hides it instead.
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    if cfg!(target_os = "macos") {
        tray.set_icon_as_template(false)?;
    }
    *current = Some(tray);
    Ok(())
}

#[tauri::command]
pub fn set_tray(app: AppHandle, enabled: bool, recording: bool, labels: TrayLabels) -> Result<()> {
    apply(&app, enabled, recording, labels)
}
