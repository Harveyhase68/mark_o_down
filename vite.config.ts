/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Tauri expects a fixed port; the WebView2 on Windows is evergreen Chromium.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // tests read Temml's stylesheet as text (exported pages embed it)
  test: { css: { include: [/temml/] } },
})
