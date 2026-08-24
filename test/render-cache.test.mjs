import assert from 'node:assert/strict';
import test from 'node:test';

import { NativeRenderCache, nativeRenderCacheKey } from '../src/render-cache.mjs';

function key(overrides = {}) {
  return nativeRenderCacheKey({
    documentUri: 'file:///model.scad',
    executable: '/usr/bin/openscad',
    code: 'cube(10);',
    files: [],
    ...overrides
  });
}

test('native render keys change with source, document, executable, and dependencies', () => {
  const original = key({ files: [{ name: 'shape.svg', data: 'first' }] });
  assert.notEqual(original, key({ code: 'cube(20);', files: [{ name: 'shape.svg', data: 'first' }] }));
  assert.notEqual(original, key({ documentUri: 'file:///other/model.scad', files: [{ name: 'shape.svg', data: 'first' }] }));
  assert.notEqual(original, key({ executable: '/opt/openscad', files: [{ name: 'shape.svg', data: 'first' }] }));
  assert.notEqual(original, key({ files: [{ name: 'shape.svg', data: 'second' }] }));
});

test('native render keys are independent of dependency enumeration order', () => {
  assert.equal(
    key({ files: [{ name: 'b.svg', data: 'b' }, { name: 'a.svg', data: 'a' }] }),
    key({ files: [{ name: 'a.svg', data: 'a' }, { name: 'b.svg', data: 'b' }] })
  );
});

test('native render cache evicts least-recently-used entries and enforces byte bounds', () => {
  const cache = new NativeRenderCache({ maxEntries: 2, maxBytes: 5 });
  cache.set('a', { data: Buffer.alloc(2) });
  cache.set('b', { data: Buffer.alloc(2) });
  assert.ok(cache.get('a'));
  cache.set('c', { data: Buffer.alloc(2) });
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));

  cache.set('too-large', { data: Buffer.alloc(6) });
  assert.equal(cache.get('too-large'), undefined);
});
