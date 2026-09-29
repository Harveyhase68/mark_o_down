// Formulas: TeX → MathML with Temml. MathML is drawn by the web engine itself
// (WebView2, WebKit), so no math fonts have to be shipped. Loaded only when a
// document contains math (separate chunk, ~170 KB).

export interface MathRenderer {
  /** MathML for a formula; a TeX error comes back as a red error message, it never throws. */
  render(tex: string, display: boolean): string
  /** Temml's stylesheet (for exported pages; the editor gets it with the chunk). */
  css: string
}

let loading: Promise<MathRenderer> | null = null

export function loadMath(): Promise<MathRenderer> {
  loading ??= Promise.all([import('temml'), import('temml/dist/Temml-Local.css?raw')]).then(([m, css]) => {
    const temml = m.default
    return {
      render: (tex, display) => temml.renderToString(tex, { displayMode: display, annotate: true, throwOnError: false }),
      // the @font-face (a script font for \mathscr) points to a file next to the CSS: not in a single-page export
      css: css.default.replace(/@font-face\s*{[^}]*}/g, ''),
    }
  })
  return loading
}
