import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMeasuredValue,
  measurementInterval,
  measurementTickRange,
  orthographicWorldUnitsPerPixel,
  paddedMeasurementRange,
  perspectiveWorldUnitsPerPixel
} from '../media/measurement-utils.mjs';

test('perspective scale reports world units per viewport pixel', () => {
  assert.ok(Math.abs(perspectiveWorldUnitsPerPixel(100, 90, 1000) - 0.2) < 1e-12);
  assert.equal(perspectiveWorldUnitsPerPixel(100, 45, 0), 0);
});

test('orthographic scale accounts for zoom and viewport height', () => {
  assert.equal(orthographicWorldUnitsPerPixel(200, 2, 1000), 0.1);
  assert.equal(orthographicWorldUnitsPerPixel(200, 0, 1000), 0);
});

test('measurement intervals follow the 1/2/5 sequence across magnitudes', () => {
  assert.equal(measurementInterval(0.001, 80), 0.1);
  assert.equal(measurementInterval(0.02, 80), 2);
  assert.equal(measurementInterval(0.08, 80), 10);
  assert.equal(measurementInterval(20, 80), 2000);
});

test('measurement ranges include the origin for one-sided and crossing bounds', () => {
  assert.deepEqual(paddedMeasurementRange(12, 28, 2), { min: -2, max: 30 });
  assert.deepEqual(paddedMeasurementRange(-28, -12, 2), { min: -30, max: 2 });
  assert.deepEqual(paddedMeasurementRange(-8, 12, 2), { min: -10, max: 14 });
});

test('tick ranges cover positive-only, negative-only, and crossing ranges', () => {
  assert.deepEqual(measurementTickRange(2, 12, 5), { first: 1, last: 2 });
  assert.deepEqual(measurementTickRange(-12, -2, 5), { first: -2, last: -1 });
  assert.deepEqual(measurementTickRange(-6, 6, 5), { first: -1, last: 1 });
});

test('measurement formatting avoids negative zero and preserves tiny values', () => {
  assert.equal(formatMeasuredValue(-1e-14, 0.01), '0');
  assert.equal(formatMeasuredValue(1e-8, 1e-8), '1e-8');
  assert.equal(formatMeasuredValue(1.25, 0.25), '1.25');
});
