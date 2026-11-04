import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import OpenSCAD from '../media/openscad.js';
import { installFonts, loadFontAssets } from '../media/fonts.js';

const wasmBinary = await readFile(new URL('../media/openscad.wasm', import.meta.url));
const fontAssets = await loadFontAssets((fileName) =>
  readFile(new URL(`../media/fonts/${fileName}`, import.meta.url))
);

async function exportModel(format, source = 'cube(10);', { fonts = false } = {}) {
  const stderr = [];
  const module = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    print: () => {},
    printErr: (line) => stderr.push(line),
  });

  if (fonts) installFonts(module, fontAssets);
  module.FS.writeFile('/in.scad', source);
  const result = module.callMain([
    '/in.scad',
    '-o',
    '/out',
    `--export-format=${format}`,
  ]);

  assert.equal(result, 0, stderr.join('\n'));
  return { output: module.FS.readFile('/out'), stderr };
}

test('exports binary STL', async () => {
  const { output } = await exportModel('binstl');

  assert.equal(output.byteLength, 684);
  assert.equal(new DataView(output.buffer, output.byteOffset).getUint32(80, true), 12);
});

test('exports a ZIP-based 3MF package', async () => {
  const { output } = await exportModel('3mf');
  const archive = Buffer.from(output);

  assert.ok(output.byteLength > 100);
  assert.deepEqual([...output.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(archive.includes(Buffer.from('[Content_Types].xml')));
  assert.ok(archive.includes(Buffer.from('3D/3dmodel.model')));
});

test('renders text with the bundled Liberation fonts', async () => {
  const { output, stderr } = await exportModel(
    'binstl',
    'linear_extrude(1) text("TEST", font="Liberation Sans:style=Bold");',
    { fonts: true }
  );

  assert.ok(output.byteLength > 684);
  assert.doesNotMatch(stderr.join('\n'), /fontconfig|can't get font/i);
});
