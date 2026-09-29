// Print the rendered document (like the HTML export), not the editor UI.

import { renderHtmlPage } from '../md/html'
import { renderOptions } from '../md/renderOptions'
import { getLang } from '../i18n'

/** Renders into a hidden iframe, resolves local images, then opens the print dialog. */
export async function printMarkdown(markdown: string, title: string, resolveImage: (src: string) => string): Promise<void> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  // The document may contain raw HTML (<script>, onerror=…) from an untrusted .md.
  // No 'allow-scripts': nothing in it may run – it would share the app's origin
  // and with it access to the Tauri file commands. allow-modals: print dialog.
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.append(frame)
  const opts = await renderOptions(markdown)

  await new Promise<void>((resolve) => {
    frame.onload = () => resolve()
    frame.srcdoc = renderHtmlPage(markdown, title, getLang(), opts)
  })
  const doc = frame.contentDocument!
  const win = frame.contentWindow!

  // relative/local image paths → URLs the webview can load
  const images = [...doc.images]
  for (const img of images) {
    const src = img.getAttribute('src')
    if (src) img.src = resolveImage(src)
  }
  const loaded = (img: HTMLImageElement) =>
    new Promise<void>((resolve) => {
      if (img.complete) return resolve()
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })
  // wait for images (badges come from the web), but not forever
  await Promise.race([Promise.all(images.map(loaded)), new Promise((r) => setTimeout(r, 4000))])

  const cleanup = () => setTimeout(() => frame.remove(), 500)
  win.addEventListener('afterprint', cleanup, { once: true })
  win.focus()
  win.print()
  setTimeout(() => frame.isConnected && frame.remove(), 5 * 60_000)
}
