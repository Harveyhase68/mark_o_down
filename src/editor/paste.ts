// Ctrl+V of links and images.
//  • image data (screenshot, "copy image")  → saved next to the document, inserted as image
//  • a URL with text selected                → the selection becomes a link
//  • a URL alone                             → a link (or an image, if it points to one)

import type { EditorView } from 'prosemirror-view'
import { schema } from '../md/schema'

const N = schema.nodes
const K = schema.marks

/** A single web address (nothing else in the clipboard text). */
export function asUrl(text: string): string | null {
  const t = text.trim()
  if (!/^(https?:\/\/|mailto:|www\.)\S+$/i.test(t)) return null
  return t
}

/** Addresses that are images: file extensions and the usual badge/icon services. */
export function isImageUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (/\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/.test(path)) return true
  return /^https?:\/\/(img\.shields\.io|badgen\.net|flat\.badgen\.net|cdn\.simpleicons\.org|forthebadge\.com\/(api|featured|images))\//i.test(url)
}

/** "https://…/Mein-Logo_2.png?x=1" → "Mein Logo 2" */
export function altFromUrl(url: string): string {
  const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '')
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim()
}

/** Paste a URL: link the selection, or insert a link / image. */
export function pasteUrl(view: EditorView, url: string) {
  const { state } = view
  const { from, to, empty, $from } = state.selection
  const href = /^www\./i.test(url) ? `https://${url}` : url

  // text selected (within one block): make it a link
  if (!empty && $from.sameParent(state.doc.resolve(to))) {
    view.dispatch(state.tr.removeMark(from, to, K.link).addMark(from, to, K.link.create({ href })).scrollIntoView())
    return
  }
  if (isImageUrl(url)) {
    view.dispatch(state.tr.replaceSelectionWith(N.image.create({ src: url, alt: altFromUrl(url) }), false).scrollIntoView())
    return
  }
  // a link showing its own address; written back as a bare URL (GFM autolink) where possible
  const marks = [...$from.marks().filter((m) => m.type !== K.link), K.link.create({ href, literal: true })]
  const tr = state.tr.replaceSelectionWith(schema.text(url, marks), false)
  view.dispatch(tr.removeStoredMark(K.link).scrollIntoView())
}

/**
 * Decide how to handle a paste. Returns what to do, or null for the default
 * ProseMirror paste (HTML/Markdown text).
 */
export function classifyPaste(data: DataTransfer, inCode: boolean): { image: File } | { url: string } | null {
  if (inCode) return null // code blocks: always plain text
  const html = data.getData('text/html')
  const image = [...data.files].find((f) => f.type.startsWith('image/'))
  // a copied web image usually comes with <img src="https://…"> – use the address, not a file
  if (image && !/<img\b/i.test(html)) return { image }
  const url = asUrl(data.getData('text/plain'))
  if (url && !/<(p|div|h\d|li|table)\b/i.test(html)) return { url }
  return null
}

/** File extension for a pasted image. */
export function imageExtension(type: string): string {
  return { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[type] ?? 'png'
}

/** "image-20260928-191530" (local time) */
export function pastedImageStem(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `image-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}
