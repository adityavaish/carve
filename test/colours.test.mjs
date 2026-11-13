import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import OpenSCAD from '../media/openscad.js';
import { parseOFF } from '../media/off.js';

const wasmBinary = readFileSync(new URL('../media/openscad.wasm', import.meta.url));

async function renderOFF(code) {
  const Module = await OpenSCAD({ noInitialRun: true, noExitRuntime: true, wasmBinary, print: () => {}, printErr: () => {} });
  Module.FS.writeFile('/in.scad', code);
  assert.equal(Module.callMain(['/in.scad', '-o', '/out', '--export-format=off']), 0);
  return new TextDecoder().decode(Module.FS.readFile('/out'));
}

/** Distinct colours in a parsed mesh, as "r,g,b,a" strings with 0-255 components. */
const palette = ({ colors }) => {
  const seen = new Set();
  for (let i = 0; i < colors.length; i += 4) {
    seen.add([...colors.slice(i, i + 4)].map((c) => Math.round(c * 255)).join(','));
  }
  return [...seen].sort();
};

test('parseOFF triangulates faces and reads optional colours', () => {
  const mesh = parseOFF('OFF 4 2 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3 255 0 0 127\n3 0 1 2\n', [0, 0, 1]);
  assert.equal(mesh.positions.length / 9, 3, 'quad becomes two triangles, plus one');
  assert.deepEqual(palette(mesh), ['0,0,255,255', '255,0,0,127']);
  assert.equal(mesh.hasAlpha, true);
});

test('color() survives from OpenSCAD to the preview mesh', async () => {
  const off = await renderOFF(
    'color("red") cube(10); translate([20,0,0]) color([0,1,0,0.5]) cube(5); translate([40,0,0]) cube(5);');
  const mesh = parseOFF(off);
  assert.equal(mesh.positions.length / 9, 36, 'three cubes');
  const colours = palette(mesh);
  assert.ok(colours.includes('255,0,0,255'), 'red cube');
  assert.ok(colours.includes('0,255,0,128') || colours.includes('0,255,0,127'), 'half-transparent green cube');
  assert.equal(colours.length, 3, 'uncoloured cube gets one more colour');
});

test('colours survive boolean operations', async () => {
  const mesh = parseOFF(await renderOFF(
    'difference() { color("red") cube(10, center=true); color("blue") sphere(6, $fn=16); }'));
  const colours = palette(mesh);
  assert.ok(colours.includes('255,0,0,255') && colours.includes('0,0,255,255'), colours.join(' '));
});
