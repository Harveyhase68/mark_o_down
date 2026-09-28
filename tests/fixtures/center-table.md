<div align="center">

# Mark O Down 😂

[![npm](https://img.shields.io/npm/v/npm.svg?logo=nodedotjs)](https://www.npmjs.com/package/npm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Ein Mini-WYSIWYG-Editor**<br>
für Markdown

</div>

<br>

<div align='center'>
  <img src="logo.png" width="100">
  <br/>
</div>

| Aspect | Configuration | Type |
|---|---|---|
| Web server | Apache + PHP 8.4 (production-style) | prod-like |
| Frontend | `vite build --mode docker` → static `public/build` | prod-like |
| Composer | `--no-dev --optimize-autoloader` | prod-like |
| `APP_ENV` | `local` | dev |
| `APP_DEBUG` | `true` (full stacktraces in browser) | dev |
| `LOG_LEVEL` | `debug` | dev |
| OAuth secret | hardcoded in image (development-only value) | dev |
| Frontend rebuild | every container start (slow first start, instant DB visibility) | hybrid 

| Links | Zentriert | Rechts |
| :---- | :-------: | -----: |
| a     |   **b**   |      c |
| 😂    |   `x|y`   |  a\|b  |
| kurz  |

- Liste mit Tabelle:

  | A | B |
  |---|---|
  | 1 | 2 |

  <div align="center">

  zentriert in Liste

  </div>
