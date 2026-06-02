# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Playwright-driven automation script that QA-tests product loading in the **Fidel** sales system (`dev.fidel.com.ar`). For each test case it logs in as admin, opens a sales document, and loads the same product through up to four different UI flows, then asserts that all flows produce the **same price**. Test cases are driven from a Google Sheet, not from code.

## Running

There is no test runner wired up (`npm test` is a placeholder, and `tests/test.spec.js` is an empty stub — do not assume Playwright Test). The real entry point is a standalone Node script:

```bash
node test-rapido.js "https://docs.google.com/spreadsheets/d/<SHEET_ID>"
```

- Requires a `.env` with `URL_BASE`, `ADMIN_USER`, `ADMIN_PASS` (already gitignored as part of normal `.env` handling — note `.env` is currently committed in this repo).
- Launches Chromium **headed** (`headless: false`) — it drives a visible browser, so it needs a display.
- The Google Sheet must be publicly readable; it's fetched as CSV via the `/export?format=csv&gid=0` URL, **not** via the `google-spreadsheet` / `google-sheets-api` deps in package.json (those are unused).

## Architecture

Data flows in one direction: **Sheet → cases → per-case browser session**.

1. **`utiles/googleSheetsReader.js`** — `leerCasosDePrueba(url)` extracts the sheet ID from the URL, downloads it as CSV, and maps each row to a case object. Column names are Spanish and significant: `CuentaID`, `Documento`, `ClienteID`, `Producto_Codigo`, `Producto_CodigoBarra`, the `Probar_*` flags (`"SI"` = run that method), `Plantilla_Nombre`, and `Configuraciones`. Rows with no `Probar_*` set to `SI` are skipped.

2. **`test-rapido.js`** — orchestrator. Per case, opens a fresh page and runs, in fixed order: login → navigate to document → select client → run each enabled load method → collect prices → assert they're all equal. Errors are caught per-case so one failure doesn't stop the run.

3. **`utiles/login.js`** — `loginComoAdmin(page, cuentaID)`: two-step login (admin email/pass, then per-case account ID).

4. **`paginas/documents.js`** — `DocumentsPage` (Page Object): `navegar(tipoDocumento)` maps a document type (`factura`, `presupuesto`, `venta_unificada`, `pedido`, `remito`) to its Crear URL; `seleccionarCliente(clienteID)`.

5. **`componentes/productLoader.js`** — `ProductLoader` (Page Object): the four load methods (`cargarManual`, `cargarPorCodigoBarra`, `cargarAsignacionMultiple`, `cargarDesdePlantilla`), dispatched via `cargar(metodo, datos)`. Each returns the loaded price via `obtenerPrecioConTab()`.

## Conventions and gotchas specific to this code

- **Price capture is brittle by design**: `obtenerPrecioConTab()` presses `Tab` a fixed number of times to land on the price field, then reads `document.activeElement.value`. The Tab count differs per flow because the surrounding form differs.
- **Selectors are hardcoded `#select2-chosen-N` IDs** that vary per method (`-6`, `-9`, `-11`, `-13`). These are Select2 widget IDs from the Fidel UI; if a flow breaks, the index has likely shifted.
- **Synchronization is `waitForTimeout` (fixed sleeps)**, not state-based waits. Flakiness here usually means a sleep is too short for the dev environment.
- Price strings are Argentine format (`.` thousands, `,` decimal); `obtenerPrecioConTab` normalizes them before `parseFloat`.
- Known-broken: `cargarDesdePlantilla`'s "Asociar" step is marked `//NO ANDA` (doesn't work). `configApplier.js` is an empty stub even though `Configuraciones` is parsed into each case — config application is not implemented.
- Code, comments, columns, and console logs are in **Spanish** — match that when editing.
