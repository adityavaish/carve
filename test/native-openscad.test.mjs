import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findNativeOpenScad,
  nativeOpenScadCandidates,
  probeExecutable
} from '../src/native-openscad.mjs';

test('native OpenSCAD candidates prefer an explicitly configured executable', () => {
  assert.deepEqual(
    nativeOpenScadCandidates('darwin', '/custom/OpenSCAD'),
    [
      '/custom/OpenSCAD',
      'openscad',
      '/opt/homebrew/bin/openscad',
      '/usr/local/bin/openscad',
      '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
    ]
  );
});

test('native OpenSCAD detection returns the first executable that responds', async () => {
  const probes = [];
  const executable = await findNativeOpenScad({
    platform: 'linux',
    configuredPath: '/missing/custom-openscad',
    probe: async (candidate) => {
      probes.push(candidate);
      return candidate === '/usr/bin/openscad';
    }
  });

  assert.equal(executable, '/usr/bin/openscad');
  assert.deepEqual(probes, [
    '/missing/custom-openscad',
    'openscad',
    '/usr/bin/openscad'
  ]);
});

test('executable probe accepts the current Node binary and rejects a missing path', async () => {
  assert.equal(await probeExecutable(process.execPath), true);
  assert.equal(await probeExecutable('/definitely/missing/carve-openscad'), false);
});
