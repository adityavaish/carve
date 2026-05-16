# Change Log

## 0.1.4 — 2026-05-16
- Marketplace-ready: hero screenshot in README, credits, build-from-source instructions

## 0.1.3 — 2026-05-16
- Add marketplace icon and gallery banner color
- Add `bugs` and `homepage` metadata for the marketplace listing
- Long preview-status messages now wrap instead of being clipped

## 0.1.2 — 2026-05-16
- Re-instantiate the OpenSCAD WASM Module per render. Fixes auto-rerender after edits — OpenSCAD's `main()` was not safe to call twice from a single Module instance.
- Pass the changed `TextDocument` directly to the renderer instead of relying on `activeTextEditor`, which could be stale when the preview pane had focus.
- Re-send the `ready` handshake after wiring the webview message listener, to avoid a race on first open.

## 0.1.1 — 2026-05-16
- First attempt at fixing auto-rerender (set `noExitRuntime: true`; superseded by 0.1.2).

## 0.1.0 — 2026-05-16
- Initial release.
- Live SCAD preview in a webview, powered by the official OpenSCAD WASM build.
- Three.js mesh viewer with OrbitControls.
- STL / 3MF / OFF / AMF / OBJ export.
- SCAD syntax highlighting.
- Inline diagnostics from OpenSCAD stderr (parser errors mapped to Problems pane).
