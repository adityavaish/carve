import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenScadWrl } from '../media/wrl-preview.mjs';

test('parses and triangulates OpenSCAD per-face WRL colors', () => {
  const result = parseOpenScadWrl(`#VRML V2.0 utf8
    Shape { appearance Appearance { material Material { diffuseColor .9 .8 .7 } }
      geometry IndexedFaceSet {
        coord Coordinate { point [ 0 0 0, 1 0 0, 1 1 0, 0 1 0, 0 0 1 ] }
        coordIndex [ 0, 1, 2, 3, -1, 0, 4, 1, -1 ]
        colorPerVertex FALSE
        color Color { color [ 1 0 0, 0 1 0, .9 .8 .7, # default colour
        ] }
        colorIndex [ 0 1 ]
      }
    }`);

  assert.equal(result.triangleCount, 3);
  assert.equal(result.materialCount, 2);
  assert.equal(result.positions.length, 27);
  assert.deepEqual([...result.colors.slice(0, 6)], [1, 0, 0, 1, 0, 0]);
  assert.deepEqual([...result.colors.slice(-3)], [0, 1, 0]);
});

test('uses the appearance color when WRL has no colorIndex', () => {
  const result = parseOpenScadWrl(`#VRML V2.0 utf8
    Shape { appearance Appearance { material Material { diffuseColor .25 .5 .75 } }
      geometry IndexedFaceSet {
        coord Coordinate { point [ 0 0 0, 1 0 0, 0 1 0 ] }
        coordIndex [ 0, 1, 2, -1 ]
      }
    }`);

  assert.equal(result.materialCount, 1);
  assert.deepEqual([...result.colors], [
    0.25, 0.5, 0.75, 0.25, 0.5, 0.75, 0.25, 0.5, 0.75
  ]);
});

test('rejects invalid WRL rather than presenting partial geometry', () => {
  assert.throws(() => parseOpenScadWrl('solid cube'), /VRML 2/);
  assert.throws(() => parseOpenScadWrl(`#VRML V2.0 utf8
    coord Coordinate { point [ 0 0 0, 1 0 0, 0 1 0 ] }
    coordIndex [ 0 1 9 -1 ]`), /invalid vertex/);
});
