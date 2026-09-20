#[cfg(windows)]
pub fn grant_camera_permission(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    let _ = window.with_webview(move |webview| {
        if let Err(err) = attach_permission_handler(&webview) {
            eprintln!("failed to attach camera permission handler on {label}: {err}");
        }
    });
}

#[cfg(windows)]
fn attach_permission_handler(
    webview: &tauri::webview::PlatformWebview,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};

    let controller = webview.controller();
    let core = unsafe { controller.CoreWebView2().map_err(|e| e.to_string())? };

    let handler = PermissionRequestedEventHandler::create(Box::new(
        move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
            let Some(args) = args else {
                return Ok(());
            };
            unsafe {
                let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                args.PermissionKind(&mut kind)?;
                if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    let mut uri = windows_core::PWSTR::null();
                    args.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    if is_app_origin(&uri) {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                    }
                } else if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
            }
            Ok(())
        },
    ));

    let mut token = 0_i64;
    unsafe {
        core.add_PermissionRequested(&handler, &mut token)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn is_app_origin(uri: &str) -> bool {
    let lower = uri.to_ascii_lowercase();
    lower.starts_with("http://localhost")
        || lower.starts_with("https://localhost")
        || lower.starts_with("http://127.0.0.1")
        || lower.contains("tauri.localhost")
        || lower.starts_with("tauri://")
}

#[cfg(not(windows))]
pub fn grant_camera_permission(_window: &tauri::WebviewWindow) {}
