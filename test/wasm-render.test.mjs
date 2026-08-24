import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  groupCsgPreviewBranches,
  splitCsgForPreview,
  splitTopLevelCsg,
  wrap2dForPreview
} from '../media/csg-preview.mjs';
import { parseOpenScadWrl } from '../media/wrl-preview.mjs';

const mediaUrl = new URL('../media/', import.meta.url);
const loaderSource = await readFile(new URL('openscad.js', mediaUrl), 'utf8');
const wasmBinary = await readFile(new URL('openscad.wasm', mediaUrl));
const loaderUrl = `data:text/javascript;base64,${Buffer.from(loaderSource).toString('base64')}`;
const { default: OpenSCAD } = await import(loaderUrl);

async function render(code, format) {
  const stderr = [];
  const instance = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    locateFile: () => new URL('openscad.wasm', mediaUrl).href,
    print: () => {},
    printErr: (line) => stderr.push(line)
  });

  instance.FS.writeFile('/input.scad', code);
  let rc;
  try {
    rc = instance.callMain([
      '/input.scad',
      '-o',
      '/output',
      `--export-format=${format}`
    ]);
  } catch (error) {
    return { success: false, stderr: stderr.join('\n') || String(error) };
  }

  if (rc !== 0 && rc !== undefined) {
    return { success: false, stderr: stderr.join('\n') };
  }

  return {
    success: true,
    data: instance.FS.readFile('/output'),
    stderr: stderr.join('\n')
  };
}

async function renderWithFiles(code, format, files) {
  const stderr = [];
  const instance = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    locateFile: () => new URL('openscad.wasm', mediaUrl).href,
    print: () => {},
    printErr: (line) => stderr.push(line)
  });

  instance.FS.mkdirTree('/input');
  for (const [name, data] of Object.entries(files)) {
    instance.FS.writeFile(`/input/${name}`, data);
  }
  instance.FS.writeFile('/input/in.scad', code);
  let rc;
  try {
    rc = instance.callMain([
      '/input/in.scad',
      '-o',
      '/output',
      `--export-format=${format}`
    ]);
  } catch (error) {
    return { success: false, stderr: stderr.join('\n') || String(error) };
  }
  const success = rc === 0 || rc === undefined;
  return {
    success,
    data: success ? instance.FS.readFile('/output') : undefined,
    stderr: stderr.join('\n')
  };
}

function binaryStlBounds(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const facets = view.getUint32(80, true);
  const bounds = {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
  };
  for (let facet = 0; facet < facets; facet++) {
    const facetOffset = 84 + facet * 50;
    for (let vertex = 0; vertex < 3; vertex++) {
      const vertexOffset = facetOffset + 12 + vertex * 12;
      const x = view.getFloat32(vertexOffset, true);
      const y = view.getFloat32(vertexOffset + 4, true);
      const z = view.getFloat32(vertexOffset + 8, true);
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.maxZ = Math.max(bounds.maxZ, z);
    }
  }
  return bounds;
}

test('bundled OpenSCAD WASM exports 2D geometry as SVG', async () => {
  const result = await render('difference() { circle(25); circle(12.5); }', 'svg');

  assert.equal(result.success, true, result.stderr);
  assert.match(new TextDecoder().decode(result.data), /<svg\b/);
});

test('bundled OpenSCAD WASM resolves an SVG beside the input SCAD file', async () => {
  const svg = await readFile(new URL('../samples/ivy.svg', import.meta.url));
  const result = await renderWithFiles('import("ivy.svg");', 'svg', { 'ivy.svg': svg });

  assert.equal(result.success, true, result.stderr);
  assert.match(new TextDecoder().decode(result.data), /<svg\b/);
  assert.doesNotMatch(result.stderr, /Can't open import file/i);
});

test('bundled OpenSCAD WASM can run the full 2D preview pipeline for an imported SVG', async () => {
  const svg = await readFile(new URL('../samples/ivy.svg', import.meta.url));
  const files = { 'ivy.svg': svg };
  const probe = await renderWithFiles('import("ivy.svg");', 'binstl', files);
  assert.equal(probe.success, false);
  assert.match(probe.stderr, /not a 3D object/i);

  const csg = await renderWithFiles('import("ivy.svg");', 'csg', files);
  assert.equal(csg.success, true, csg.stderr);
  const branches = splitCsgForPreview(new TextDecoder().decode(csg.data));
  assert.equal(branches.length, 1);

  const flat = await renderWithFiles(wrap2dForPreview(branches[0].source), 'binstl', files);
  assert.equal(flat.success, true, flat.stderr);
  assert.ok(flat.data.byteLength > 84);
});

test('bundled OpenSCAD WASM extrudes the sample imported SVG', async () => {
  const svg = await readFile(new URL('../samples/ivy.svg', import.meta.url));
  const result = await renderWithFiles(
    'linear_extrude(height = 10) import("ivy.svg");',
    'binstl',
    { 'ivy.svg': svg }
  );

  assert.equal(result.success, true, result.stderr);
  assert.ok(result.data.byteLength > 84);
});

test('bundled OpenSCAD WASM reports a dimensional mismatch for 2D STL', async () => {
  const result = await render('circle(10);', 'binstl');

  assert.equal(result.success, false);
  assert.match(result.stderr, /not a 3D object/i);
});

test('bundled OpenSCAD WASM reports an empty top-level object', async () => {
  const result = await render('module part() { cube(10); }', 'binstl');

  assert.equal(result.success, false);
  assert.match(result.stderr, /Current top level object is empty/i);
});

test('bundled OpenSCAD WASM reports assertion messages and source lines', async () => {
  const result = await render('assert(false, "sample assertion failed"); cube(10);', 'binstl');

  assert.equal(result.success, false);
  assert.match(result.stderr, /ERROR: Assertion 'false' failed: "sample assertion failed"/);
  assert.match(result.stderr, /line 1/);
});

test('bundled OpenSCAD WASM warns and drops geometry when dimensions are mixed', async () => {
  const code = 'circle(10); translate([30, 0, 0]) cube(10);';
  const stlResult = await render(code, 'binstl');
  const svgResult = await render(code, 'svg');

  assert.equal(stlResult.success, false);
  assert.match(stlResult.stderr, /Mixing 2D and 3D objects is not supported/i);
  assert.match(stlResult.stderr, /not a 3D object/i);
  assert.equal(svgResult.success, true, svgResult.stderr);
  assert.match(svgResult.stderr, /Mixing 2D and 3D objects is not supported/i);
  assert.match(new TextDecoder().decode(svgResult.data), /<svg\b/);
});

test('bundled OpenSCAD WASM can isolate and preview independent mixed roots', async () => {
  const code = `
    module profile() { difference() { circle(10); circle(5); } }
    translate([-20, 0]) profile();
    translate([20, 0, 0]) linear_extrude(8) profile();
  `;
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const roots = splitTopLevelCsg(new TextDecoder().decode(csgResult.data));
  assert.equal(roots.length, 2);

  const flatProbe = await render(roots[0], 'binstl');
  const solidResult = await render(roots[1], 'binstl');
  assert.equal(flatProbe.success, false);
  assert.match(flatProbe.stderr, /not a 3D object/i);
  assert.equal(solidResult.success, true, solidResult.stderr);

  const flatResult = await render(wrap2dForPreview(roots[0]), 'binstl');
  assert.equal(flatResult.success, true, flatResult.stderr);
  assert.ok(flatResult.data.byteLength > 84);
});

test('hybrid preview keeps a Y-rotated 2D profile visible', async () => {
  const code = 'rotate([0, 90, 0]) circle(10); translate([25, 0, 0]) cube(10);';
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const roots = splitTopLevelCsg(new TextDecoder().decode(csgResult.data));
  assert.equal(roots.length, 2);

  const collapsedProbe = await render(roots[0], 'binstl');
  assert.equal(collapsedProbe.success, false);
  assert.match(collapsedProbe.stderr, /top level object is empty/i);

  const flatResult = await render(wrap2dForPreview(roots[0]), 'binstl');
  assert.equal(flatResult.success, true, flatResult.stderr);
  assert.ok(flatResult.data.byteLength > 84);
});

test('hybrid preview recovers a rotated circle silently dropped beside a cone', async () => {
  const code = `
    $fn = 64;
    flange_thickness = 5;
    counter_sink_radius = 4;
    cylinder(h = flange_thickness, r1 = counter_sink_radius, r2 = 0);
    rotate([0, 90, 0]) circle(50);
  `;
  const stlResult = await render(code, 'binstl');

  assert.equal(stlResult.success, true, stlResult.stderr);
  assert.doesNotMatch(stlResult.stderr, /Mixing 2D and 3D objects is not supported/i);

  const csgResult = await render(code, 'csg');
  assert.equal(csgResult.success, true, csgResult.stderr);
  const roots = splitTopLevelCsg(new TextDecoder().decode(csgResult.data));
  assert.equal(roots.length, 2);

  const solidResult = await render(roots[0], 'binstl');
  const collapsedProbe = await render(roots[1], 'binstl');
  const flatResult = await render(wrap2dForPreview(roots[1]), 'binstl');
  assert.equal(solidResult.success, true, solidResult.stderr);
  assert.equal(collapsedProbe.success, false);
  assert.match(collapsedProbe.stderr, /top level object is empty/i);
  assert.equal(flatResult.success, true, flatResult.stderr);

  const bounds = binaryStlBounds(flatResult.data);
  assert.ok(Math.abs(bounds.minX) < 1e-4, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.maxX - 0.01) < 1e-4, JSON.stringify(bounds));
  assert.ok(bounds.minY <= -49.9, JSON.stringify(bounds));
  assert.ok(bounds.maxY >= 49.9, JSON.stringify(bounds));
  assert.ok(bounds.minZ <= -49.9, JSON.stringify(bounds));
  assert.ok(bounds.maxZ >= 49.9, JSON.stringify(bounds));
});

test('hybrid preview applies a 2D profile Z translation after preview extrusion', async () => {
  const code = 'translate([0, 0, 15]) circle(10); translate([25, 0, 0]) cube(10);';
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const roots = splitTopLevelCsg(new TextDecoder().decode(csgResult.data));
  const flatResult = await render(wrap2dForPreview(roots[0]), 'binstl');

  assert.equal(flatResult.success, true, flatResult.stderr);
  const bounds = binaryStlBounds(flatResult.data);
  assert.ok(Math.abs(bounds.minZ - 15) < 1e-4, JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.maxZ - 15.01) < 1e-4, JSON.stringify(bounds));
});

test('bundled OpenSCAD WASM still exports 3D geometry as binary STL', async () => {
  const result = await render('cube(10);', 'binstl');

  assert.equal(result.success, true, result.stderr);
  assert.ok(result.data.byteLength > 84);
});

test('bundled OpenSCAD WASM exports final geometry and face colors in one WRL', async () => {
  const result = await render(
    'color("red") cube(10); color("blue") translate([15, 0, 0]) cube(10);',
    'wrl'
  );

  assert.equal(result.success, true, result.stderr);
  const parsed = parseOpenScadWrl(new TextDecoder().decode(result.data));
  assert.ok(parsed.triangleCount >= 24);
  assert.equal(parsed.materialCount, 2);
  const colors = new Set();
  for (let offset = 0; offset < parsed.colors.length; offset += 3) {
    colors.add([...parsed.colors.slice(offset, offset + 3)].join(','));
  }
  assert.deepEqual(colors, new Set(['1,0,0', '0,0,1']));
});

test('normalized CSG preserves evaluated colors through nested groups and transforms', async () => {
  const code = `
    group() {
      cylinder(h = 5, r = 10);
      translate([20, 0, 0]) {
        cylinder(h = 5, r = 2);
        color("red", 0.4) translate([0, 0, 15]) cylinder(h = 5, r1 = 4, r2 = 0);
      }
    }
  `;
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const parts = splitCsgForPreview(new TextDecoder().decode(csgResult.data));
  assert.equal(parts.length, 3);
  assert.equal(parts.filter((part) => part.color).length, 1);
  assert.deepEqual(parts.find((part) => part.color).color, { r: 1, g: 0, b: 0, a: 0.4 });

  const groups = groupCsgPreviewBranches(parts);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    const stlResult = await render(group.source, 'binstl');
    assert.equal(stlResult.success, true, stlResult.stderr);
  }
});

test('normalized CSG preserves colors nested inside a top-level union', async () => {
  const code = `
    union() {
      color("salmon") difference() { cube(10); sphere(3); }
      translate([15, 0, 0]) union() {
        color("gold") cylinder(h = 10, r = 3);
        color("dodgerblue") translate([0, 0, 10]) sphere(3);
      }
    }
  `;
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const parts = splitCsgForPreview(new TextDecoder().decode(csgResult.data));
  assert.equal(parts.length, 3);
  assert.equal(parts.filter((part) => part.color).length, 3);

  for (const part of parts) {
    const stlResult = await render(part.source, 'binstl');
    assert.equal(stlResult.success, true, stlResult.stderr);
  }
});

test('normalized CSG keeps four materials across difference and intersection', async () => {
  const code = `
    module decorated() {
      union() {
        color("gold") difference() { cube([20, 20, 4]); cube([4, 4, 4]); }
        color("red") translate([6, 6, 0]) cube([8, 8, 4]);
      }
    }
    color("white") translate([-4, 0, -2]) cube([4, 20, 2]);
    difference() {
      decorated();
      color("green") translate([2, 2, 2]) sphere(3);
    }
    intersection() {
      color("green") translate([10, 10, 3]) sphere(6);
      decorated();
    }
  `;
  const csgResult = await render(code, 'csg');

  assert.equal(csgResult.success, true, csgResult.stderr);
  const groups = groupCsgPreviewBranches(
    splitCsgForPreview(new TextDecoder().decode(csgResult.data))
  );
  assert.deepEqual(groups.map((group) => group.color), [
    { r: 1, g: 1, b: 1, a: 1 },
    { r: 1, g: 0.843137, b: 0, a: 1 },
    { r: 1, g: 0, b: 0, a: 1 },
    { r: 0, g: 0.501961, b: 0, a: 1 }
  ]);

  for (const group of groups) {
    const stlResult = await render(group.source, 'binstl');
    assert.equal(stlResult.success, true, stlResult.stderr);
    assert.ok(stlResult.data.byteLength > 84);
  }
});
