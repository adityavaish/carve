import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import OpenSCAD from '../media/openscad.js';

const wasmBinary = await readFile(new URL('../media/openscad.wasm', import.meta.url));

async function exportCube(format) {
  const stderr = [];
  const module = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    print: () => {},
    printErr: (line) => stderr.push(line),
  });

  module.FS.writeFile('/in.scad', 'cube(10);');
  const result = module.callMain([
    '/in.scad',
    '-o',
    '/out',
    `--export-format=${format}`,
  ]);

  assert.equal(result, 0, stderr.join('\n'));
  return module.FS.readFile('/out');
}

test('exports binary STL', async () => {
  const output = await exportCube('binstl');

  assert.equal(output.byteLength, 684);
  assert.equal(new DataView(output.buffer, output.byteOffset).getUint32(80, true), 12);
});

test('exports a ZIP-based 3MF package', async () => {
  const output = await exportCube('3mf');
  const archive = Buffer.from(output);

  assert.ok(output.byteLength > 100);
  assert.deepEqual([...output.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(archive.includes(Buffer.from('[Content_Types].xml')));
  assert.ok(archive.includes(Buffer.from('3D/3dmodel.model')));
});
