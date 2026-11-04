# Bundled OpenSCAD WebAssembly

The `openscad.js` and `openscad.wasm` files in this directory come from the
official OpenSCAD development snapshot:

- Version: `2026.11.01`
- Artifact: `OpenSCAD-2026.11.01-WebAssembly-web.zip`
- Source: <https://files.openscad.org/snapshots/OpenSCAD-2026.11.01-WebAssembly-web.zip>
- Artifact SHA-256: `9c15e6e36f11a7d184449e4e8af13ee35d661ca81cc3a4c752546d41a51ba13c`
- `openscad.js` SHA-256: `cd885089e5bb9d04ea4a100fd10d295cf783190263e3179a65f8c35d3bbe1db9`
- `openscad.wasm` SHA-256: `c30720e9d29895fcc0f5e54a25bcbcf2bfa2d7ca50132fb6d09296bd56c7ae81`

The artifact checksum was verified against the adjacent `.sha256` file served
by `files.openscad.org` before the files were copied into this repository.

## Fonts

The bundled Liberation fonts come from the revision pinned by the matching
`openscad/openscad-wasm` build:

- Source: <https://github.com/shantigilbert/liberation-fonts-ttf>
- Commit: `ef7161f03e305982b0b247e9a0b7cc472376dd83`
- License: GNU General Public License v2 with font embedding exception; see
  [`fonts/LICENSE`](fonts/LICENSE).

At runtime, `fonts.js` mounts these files and `fonts.conf` at `/fonts` in every
fresh Emscripten filesystem before OpenSCAD evaluates the model.
