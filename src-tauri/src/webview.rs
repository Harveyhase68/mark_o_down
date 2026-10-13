//! The window is an app, not a browser (Windows / WebView2):
//!  • the browser's own keys are off – F5 / Ctrl+R would reload the page (all tabs and
//!    unsaved changes in memory gone), Ctrl+Shift+I devtools … The page still gets them
//!    (F5 refreshes the folder tree).
//!  • F6 and F7 never reach the web view: F6 (focus to an address bar we don't have) makes
//!    the WebView2 browser process exit, leaving a dead window; F7 asks about caret browsing.
//!  • if the web view crashes anyway: the page is loaded again (its tabs come back from the
//!    recovery copy), and if the whole browser process is gone the app restarts – a window
//!    that can't even be closed any more is the worst outcome.

#[cfg(windows)]
pub fn harden(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    let app = window.app_handle().clone();
    let result = window.with_webview(move |wv| {
        // SAFETY: WebView2 COM calls on the webview's own (main) thread
        if let Err(e) = unsafe { imp::setup(wv, app) } {
            eprintln!("web view setup: {}", e.message());
        }
    });
    if let Err(e) = result {
        eprintln!("web view setup: {e}");
    }
}

#[cfg(not(windows))]
pub fn harden(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
mod imp {
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED, ICoreWebView2Settings3,
    };
    use webview2_com::{AcceleratorKeyPressedEventHandler, ProcessFailedEventHandler};
    use windows::core::Interface;

    const VK_F6: u32 = 0x75;
    const VK_F7: u32 = 0x76;

    pub unsafe fn setup(wv: PlatformWebview, app: tauri::AppHandle) -> windows::core::Result<()> {
        unsafe {
            let controller = wv.controller();
            let core = controller.CoreWebView2()?;
            let settings: ICoreWebView2Settings3 = core.Settings()?.cast()?;
            settings.SetAreBrowserAcceleratorKeysEnabled(false)?;

            let keys = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    let mut key = 0u32;
                    args.VirtualKey(&mut key)?;
                    if key == VK_F6 || key == VK_F7 {
                        args.SetHandled(true)?;
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            controller.add_AcceleratorKeyPressed(&keys, &mut token)?;

            let failed = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(args) = args {
                    args.ProcessFailedKind(&mut kind)?;
                }
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    eprintln!("web view: browser process exited – restarting");
                    let app = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        app.restart();
                    });
                } else if let Some(core) = sender {
                    // the page's process: load it again (the browser is still there)
                    eprintln!("web view: page process failed ({}) – reloading", kind.0);
                    core.Reload()?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            core.add_ProcessFailed(&failed, &mut token)?;
            Ok(())
        }
    }
}
