# Carve

<p align="center">
  <img src="images/icon.png" width="120" alt="Carve icon" />
</p>

**Carve** is a VS Code extension that gives you a live, no-install preview of 2D and 3D [OpenSCAD](https://openscad.org/) `.scad` files in one orbitable 3D viewer — entirely in-browser via WebAssembly. No native OpenSCAD binary required.

![Carve hero](images/hero.png)

## Features

- 🔄 **Live preview** — open any `.scad` file, hit `Ctrl+K V`, and watch your model update as you type
- 📐 **2D geometry** — renders top-level 2D models as flat geometry in the same orbitable 3D scene
- 🧩 **Hybrid preview** — shows independent flat 2D profiles beside solid 3D geometry in one orbitable scene
- 🧱 **Self-contained** — ships the full OpenSCAD engine as ~10 MB of WebAssembly, plus a Three.js mesh viewer
- 🧭 **OrbitControls** — drag to orbit, scroll to zoom, right-click to pan
- 🧊 **Plane view presets** — jump to +X/−X, +Y/−Y, or +Z/−Z-aligned views, then keep orbiting normally
- 📽️ **Projection toggle** — switch between perspective and isometric/orthographic views
- 📤 **Export** — STL / 3MF / OFF / AMF / OBJ via `Carve: Export STL`
- 🪲 **Inline diagnostics** — OpenSCAD parser/render errors surface in VS Code's Problems pane
- 🧾 **Compilation log** — inspect OpenSCAD assertions, errors, warnings, echoes, and render statistics in the preview
- 🌐 **Works in vscode.dev / Codespaces / Remote SSH** — pure WASM, no native deps
- 🎨 **Syntax highlighting** for the SCAD language

## Usage

1. Open any `.scad` file
2. Press **`Ctrl+K V`** (`Cmd+K V` on macOS) to open the preview beside the editor
3. Edit your code — the model re-renders ~500 ms after you stop typing
4. Drag the viewer to orbit, scroll to zoom
5. Select **Compilation log** at the bottom of the preview to inspect OpenSCAD output
6. Run **`Carve: Export STL`** from the command palette to save geometry to disk

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
| `carve.fontFiles` | `[]` | Extra font file paths for `text()` (supports `.ttf`, `.otf`, `.ttc`, `.otc`, and `~`) |

Carve automatically makes fonts referenced by a literal `font = "Family Name"` available from the extension host's standard system font folders. If the font family does not resemble its filename, add its file path to `carve.fontFiles`. In Remote SSH or Codespaces, these are the remote host's fonts rather than fonts installed on your local computer.

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
git clone https://github.com/adityavaish/carve.git
cd carve
npm install
npm run package      # builds dist/extension.js with esbuild
npx vsce package --no-dependencies   # produces carve-X.Y.Z.vsix
code --install-extension carve-*.vsix
```

## License

MIT — except for the bundled `media/openscad.{js,wasm}` (GPL-2.0-or-later with CGAL exception) and Three.js (MIT). See [`LICENSE`](LICENSE).

## Credits

- [OpenSCAD](https://openscad.org/) — the engine doing the actual work
- [openscad-wasm](https://github.com/openscad/openscad-wasm) — Emscripten toolchain & Docker base image
- [openscad-playground](https://github.com/openscad/openscad-playground) — inspiration & prior art
- [Three.js](https://threejs.org/) — the mesh viewer
