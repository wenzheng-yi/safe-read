use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use url::Url;

pub static QUITTING: AtomicBool = AtomicBool::new(false);

const READER_LABEL: &str = "reader";
const MAIN_LABEL: &str = "main";

// Must be async on Windows: sync commands deadlock inside WebviewWindowBuilder::build
// (blank/black window that cannot be closed).
#[tauri::command]
pub async fn open_reader(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = normalize_url(&url)?;
    if let Some(reader) = app.get_webview_window(READER_LABEL) {
        reader.navigate(parsed).map_err(|e| e.to_string())?;
        show_window(&reader)?;
        hide_settings(&app)?;
        return Ok(());
    }

    let last_url = Arc::new(Mutex::new(parsed.clone()));
    let nav_url = last_url.clone();

    let reader = WebviewWindowBuilder::new(&app, READER_LABEL, WebviewUrl::External(parsed))
        .title("SafeRead")
        .inner_size(1200.0, 800.0)
        .resizable(true)
        .maximized(false)
        .visible(true)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::utils::config::Color(0, 0, 0, 255))
        .on_navigation(move |url| {
            if let Ok(mut guard) = nav_url.lock() {
                *guard = url.clone();
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    apply_black_titlebar(&reader);

    let app_handle = app.clone();
    let was_minimized = Arc::new(AtomicBool::new(false));
    let closed_url = last_url.clone();
    let closed_emitted = Arc::new(AtomicBool::new(false));
    reader.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { .. } => {
                if !closed_emitted.swap(true, Ordering::Relaxed) {
                    let url = current_reader_url(&app_handle, &closed_url);
                    let _ = app_handle.emit("reader-closed", url);
                }
            }
            WindowEvent::Destroyed if !QUITTING.load(Ordering::Relaxed) => {
                if !closed_emitted.swap(true, Ordering::Relaxed) {
                    let url = closed_url
                        .lock()
                        .map(|u| u.to_string())
                        .unwrap_or_default();
                    let _ = app_handle.emit("reader-closed", url);
                }
                let _ = show_settings_window(&app_handle);
            }
            WindowEvent::Resized(_) => {
                let Some(window) = app_handle.get_webview_window(READER_LABEL) else {
                    return;
                };
                let now = window.is_minimized().unwrap_or(false);
                let prev = was_minimized.swap(now, Ordering::Relaxed);
                if now && !prev {
                    let _ = app_handle.emit("reader-minimized", ());
                } else if !now && prev {
                    let _ = app_handle.emit("reader-restored", ());
                }
            }
            WindowEvent::Focused(focused) => {
                let Some(window) = app_handle.get_webview_window(READER_LABEL) else {
                    return;
                };
                // Minimized windows also lose focus; minimize handlers own that case.
                if window.is_minimized().unwrap_or(false) {
                    return;
                }
                if *focused {
                    let _ = app_handle.emit("reader-focused", ());
                } else {
                    let _ = app_handle.emit("reader-blurred", ());
                }
            }
            _ => {}
        }
    });

    hide_settings(&app)?;
    Ok(())
}

fn current_reader_url(app: &AppHandle, fallback: &Arc<Mutex<Url>>) -> String {
    if let Some(window) = app.get_webview_window(READER_LABEL) {
        if let Ok(url) = window.url() {
            if let Ok(mut guard) = fallback.lock() {
                *guard = url.clone();
            }
            return url.to_string();
        }
    }
    fallback
        .lock()
        .map(|u| u.to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub fn hide_app(app: AppHandle) -> Result<(), String> {
    for label in [READER_LABEL, MAIN_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|e| e.to_string())?;
            window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
        }
    }
    let _ = app.emit("privacy-hidden", ());
    Ok(())
}

#[tauri::command]
pub fn restore_app(app: AppHandle) -> Result<(), String> {
    restore_windows(&app, false)
}

#[tauri::command]
pub fn show_settings(app: AppHandle) -> Result<(), String> {
    show_settings_window(&app)
}

pub fn restore_windows<R: Runtime>(app: &AppHandle<R>, open_settings: bool) -> Result<(), String> {
    if let Some(reader) = app.get_webview_window(READER_LABEL) {
        show_window(&reader)?;
        let _ = reader.set_focus();
        if !open_settings {
            hide_settings(app)?;
        }
    }
    if open_settings || app.get_webview_window(READER_LABEL).is_none() {
        show_settings_window(app)?;
    }
    if app.get_webview_window(READER_LABEL).is_some() {
        let _ = app.emit("privacy-restored", ());
    }
    Ok(())
}

pub fn show_settings_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return Ok(());
    };
    show_window(&main)?;
    let _ = main.set_focus();
    Ok(())
}

fn hide_settings<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.hide().map_err(|e| e.to_string())?;
        main.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window
        .set_skip_taskbar(false)
        .map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn apply_black_titlebar<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_theme(Some(tauri::Theme::Dark));
    #[cfg(windows)]
    {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        unsafe {
            use windows_sys::Win32::Graphics::Dwm::{
                DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR,
                DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
            };

            let handle = hwnd.0 as windows_sys::Win32::Foundation::HWND;
            let dark: i32 = 1;
            let black: u32 = 0x000000;
            let white: u32 = 0x00FF_FFFF;
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
                std::ptr::from_ref(&dark).cast(),
                std::mem::size_of_val(&dark) as u32,
            );
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_CAPTION_COLOR as u32,
                std::ptr::from_ref(&black).cast(),
                std::mem::size_of_val(&black) as u32,
            );
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_BORDER_COLOR as u32,
                std::ptr::from_ref(&black).cast(),
                std::mem::size_of_val(&black) as u32,
            );
            let _ = DwmSetWindowAttribute(
                handle,
                DWMWA_TEXT_COLOR as u32,
                std::ptr::from_ref(&white).cast(),
                std::mem::size_of_val(&white) as u32,
            );
        }
    }
}

fn normalize_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("网页地址不能为空".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    Url::parse(&with_scheme).map_err(|e| format!("无效网址: {e}"))
}
