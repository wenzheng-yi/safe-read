mod camera_permission;
mod windows_ctrl;

use camera_permission::grant_camera_permission;
use std::sync::atomic::Ordering;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use windows_ctrl::{
    apply_black_titlebar, hide_app, open_reader, restore_app, restore_windows, show_settings,
    QUITTING,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = restore_windows(app, false);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_reader,
            hide_app,
            restore_app,
            show_settings
        ])
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                apply_black_titlebar(&main);
                #[cfg(windows)]
                grant_camera_permission(&main);

                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if !QUITTING.load(Ordering::Relaxed) {
                            api.prevent_close();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                                let _ = window.set_skip_taskbar(true);
                            }
                        }
                    }
                });
            }

            let show_item = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("missing default window icon"),
                )
                .tooltip("SafeRead")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = restore_windows(app, false);
                    }
                    "settings" => {
                        let _ = restore_windows(app, true);
                    }
                    "quit" => {
                        QUITTING.store(true, Ordering::Relaxed);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = restore_windows(tray.app_handle(), false);
                    }
                })
                .build(app)?;

            app.global_shortcut()
                .register("ctrl+shift+s")
                .map_err(|e| e.to_string())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
