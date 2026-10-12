//! "Save as PDF": the rendered page (same as the HTML export) is loaded into a hidden
//! window and printed to a PDF file by the web engine – real, selectable text and
//! working links, no print dialog. Windows only (WebView2 `PrintToPdf`); elsewhere
//! the command answers `PDF_UNSUPPORTED` and the frontend opens the print dialog,
//! which has "Save as PDF" (macOS) / "Print to File" (Linux).

#[cfg_attr(windows, allow(dead_code))] // answered on macOS/Linux
pub const UNSUPPORTED: &str = "PDF_UNSUPPORTED";

#[tauri::command]
pub async fn save_pdf(app: tauri::AppHandle, html: String, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_pdf::save(app, html, path).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, html, path);
        Err(UNSUPPORTED.into())
    }
}

/// `encodeURIComponent` – how the frontend's `convertFileSrc` builds asset URLs.
#[cfg_attr(not(windows), allow(dead_code))]
fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(windows)]
mod windows_pdf {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;

    use tauri::webview::{PageLoadEvent, PlatformWebview};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_7, ICoreWebView2Environment6,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    type Done = mpsc::Sender<Result<(), String>>;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    pub async fn save(app: tauri::AppHandle, html: String, path: String) -> Result<(), String> {
        // the page as a file the hidden window loads through the asset protocol (like
        // the document's images, whose src the frontend has already turned into asset URLs)
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("pdf");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let page = dir.join(format!("page-{}-{n}.html", std::process::id()));
        std::fs::write(&page, html).map_err(|e| e.to_string())?;
        let _ = app.asset_protocol_scope().allow_file(&page);
        let url = format!("http://asset.localhost/{}", super::encode_uri_component(&page.to_string_lossy()));

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let started = std::sync::atomic::AtomicBool::new(false);
        let window = WebviewWindowBuilder::new(&app, format!("pdf-{n}"), WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
            .visible(false)
            .on_page_load(move |w, payload| {
                if payload.event() != PageLoadEvent::Finished || started.swap(true, Ordering::SeqCst) {
                    return;
                }
                let inner = tx.clone();
                let target = path.clone();
                let sent = w.with_webview(move |wv| {
                    // SAFETY: WebView2 COM calls on the webview's own (main) thread
                    if let Err(e) = unsafe { print(wv, &target, inner.clone()) } {
                        let _ = inner.send(Err(e));
                    }
                });
                if let Err(e) = sent {
                    let _ = tx.send(Err(e.to_string()));
                }
            })
            .build()
            .map_err(|e| e.to_string())?;

        // the page has its images and diagrams inline or from disk: a minute is plenty
        let result = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(60)))
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|_| Err("timeout".into()));
        let _ = window.destroy();
        let _ = std::fs::remove_file(&page);
        result
    }

    /// A4 portrait, no header/footer lines, backgrounds (code blocks, tables) printed.
    unsafe fn print(wv: PlatformWebview, path: &str, done: Done) -> Result<(), String> {
        let err = |e: windows::core::Error| e.message().to_string();
        unsafe {
            let core = wv.controller().CoreWebView2().map_err(err)?;
            let core7: ICoreWebView2_7 = core.cast().map_err(err)?;
            let env: ICoreWebView2Environment6 = wv.environment().cast().map_err(err)?;
            let settings = env.CreatePrintSettings().map_err(err)?;
            settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(err)?;
            settings.SetPageWidth(8.27).map_err(err)?; // A4, inches
            settings.SetPageHeight(11.69).map_err(err)?;
            settings.SetMarginTop(0.6).map_err(err)?;
            settings.SetMarginBottom(0.6).map_err(err)?;
            settings.SetMarginLeft(0.6).map_err(err)?;
            settings.SetMarginRight(0.6).map_err(err)?;
            settings.SetShouldPrintHeaderAndFooter(false).map_err(err)?;
            settings.SetShouldPrintBackgrounds(true).map_err(err)?;
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
                let _ = done.send(match result {
                    Ok(()) if ok => Ok(()),
                    Ok(()) => Err("the PDF could not be written".into()),
                    Err(e) => Err(e.message().to_string()),
                });
                Ok(())
            }));
            core7.PrintToPdf(&HSTRING::from(path), &settings, &handler).map_err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn asset_urls_encode_like_the_frontend() {
        assert_eq!(super::encode_uri_component(r"C:\Users\Jürgen\a b.html"), "C%3A%5CUsers%5CJ%C3%BCrgen%5Ca%20b.html");
    }
}
