# Carve

**Carve** is a VS Code extension that gives you a live, no-install 3D preview of [OpenSCAD](https://openscad.org/) `.scad` files — entirely in-browser via WebAssembly. No native OpenSCAD binary required.

## Features

- 🔄 **Live preview** — open any `.scad` file, hit `Ctrl+K V`, and see your model update as you type
- 🧱 **Self-contained** — ships the full OpenSCAD engine as ~10 MB of WebAssembly, plus a Three.js mesh viewer
- 🧭 **OrbitControls** — drag to orbit, scroll to zoom, right-click to pan
- 📤 **Export** — STL / 3MF / OFF / AMF / OBJ via `Carve: Export STL`
- 🪲 **Inline diagnostics** — OpenSCAD parser/render errors surface in VS Code's Problems pane
- 🌐 **Works in vscode.dev / Codespaces / Remote SSH** — pure WASM, no native deps
- 🎨 **Syntax highlighting** for the SCAD language

## Commands

| Command | Default keybinding | Description |
| --- | --- | --- |
| `Carve: Open Live Preview` | `Ctrl+K V` | Open the preview pane beside the editor |
| `Carve: Re-render` | `Ctrl+Shift+R` | Force a re-render of the current file |
| `Carve: Export STL` | — | Export the current model to disk |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `carve.autoRender` | `true` | Re-render as you type |
| `carve.debounceMs` | `500` | Delay before re-rendering after a change |
| `carve.exportFormat` | `binstl` | Format for `Carve: Export STL` (`binstl`, `asciistl`, `off`, `amf`, `3mf`, `obj`) |

## How it works

```
┌─── VS Code Extension (Node) ────┐
│  TextDocument listener          │
│  Webview panel manager          │
│  Diagnostics from stderr        │
└────────────┬────────────────────┘
             │ postMessage
             ▼
┌─── Webview (Chromium sandbox) ──┐
│  openscad.wasm  (full engine)   │
│  Three.js (mesh viewer)         │
└─────────────────────────────────┘
```

The OpenSCAD WASM build comes from the upstream [openscad/openscad-wasm](https://github.com/openscad/openscad-wasm) toolchain.

## Build from source

```pwsh
npm install
npm run package      # builds dist/extension.js with esbuild
npx vsce package --no-dependencies   # produces carve-X.Y.Z.vsix
code --install-extension carve-*.vsix
```

## License

MIT — except for the bundled `media/openscad.{js,wasm}` (GPL-2.0-or-later with CGAL exception) and Three.js (MIT). See `LICENSE`.
