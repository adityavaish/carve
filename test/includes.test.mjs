import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import OpenSCAD from '../media/openscad.js';
import { moduleOptions, runJob } from '../media/run.js';
import { collectDeps, toVirtual } from '../dist/deps.mjs';

const wasmBinary = readFileSync(new URL('../media/openscad.wasm', import.meta.url));
const enc = (s) => new TextEncoder().encode(s);

// A project that reaches its dependencies every way OpenSCAD allows.
const entry = '/proj/apps/box/main.scad';
const code = 'include <../../libs/local.scad>\nuse <mylib/shapes.scad>\nlocal(); shape();';
const disk = {
  '/proj/libs/local.scad': 'include <nested/inner.scad>\nmodule local() inner();',
  '/proj/libs/nested/inner.scad': 'module inner() cube(1);',
  '/shared/mylib/shapes.scad': 'use <helper.scad>\nmodule shape() translate([5,0,0]) helper();',
  '/shared/mylib/helper.scad': 'module helper() sphere(1, $fn = 8);'
};
const read = async (p) => (p in disk ? enc(disk[p]) : undefined);

async function render(job) {
  const stderr = [];
  const Module = await OpenSCAD({ ...moduleOptions, wasmBinary, print: () => {}, printErr: (s) => stderr.push(s) });
  return { ...runJob(Module, job, 'binstl'), stderr: stderr.join('\n') };
}

test('collectDeps follows relative, nested and library includes', async () => {
  const deps = await collectDeps(entry, code, ['/missing', '/shared'], read);
  assert.deepEqual([...deps.keys()].sort(), [
    '/libraries/mylib/helper.scad',
    '/libraries/mylib/shapes.scad',
    '/proj/libs/local.scad',
    '/proj/libs/nested/inner.scad'
  ]);
  assert.equal(deps.get('/libraries/mylib/shapes.scad').real, '/shared/mylib/shapes.scad');
});

test('toVirtual maps Windows paths into the POSIX filesystem', () => {
  assert.equal(toVirtual('C:\\Users\\me\\a.scad'), '/C/Users/me/a.scad');
  assert.equal(toVirtual('/home/me/a.scad'), '/home/me/a.scad');
});

test('a file with includes renders once its dependencies are mounted', async () => {
  const deps = await collectDeps(entry, code, ['/shared'], read);
  const ok = await render({ entry, code, files: [...deps].map(([v, d]) => [v, d.data]) });
  assert.equal(ok.rc, 0, ok.stderr);
  assert.ok(ok.data.length > 84, 'STL has triangles');

  const bare = await render({ entry, code, files: [] });
  assert.match(bare.stderr, /Can't find include file/);
});
