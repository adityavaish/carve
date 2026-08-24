import assert from 'node:assert/strict';
import test from 'node:test';

import {
  orthographicFitZoom,
  perspectiveFitDistance,
  safeViewportFractions
} from '../media/view-fit.mjs';

const isometric = { x: 1, y: 1, z: 1 };
const up = { x: 0, y: 1, z: 0 };

test('perspective fit respects the narrower horizontal field in portrait viewports', () => {
  const landscape = perspectiveFitDistance({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    verticalFovDegrees: 45, viewportWidth: 1200, viewportHeight: 800
  });
  const portrait = perspectiveFitDistance({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    verticalFovDegrees: 45, viewportWidth: 800, viewportHeight: 1200
  });
  assert.ok(portrait > landscape * 1.2);
});

test('perspective fit places every axis-aligned box corner inside the frustum', () => {
  const distance = perspectiveFitDistance({
    halfSize: { x: 50, y: 25, z: 6 },
    direction: { x: 0, y: 0, z: 1 },
    up,
    verticalFovDegrees: 90,
    viewportWidth: 800,
    viewportHeight: 1200
  });
  // Horizontal FOV is limiting: 6 units to the front face plus 50 / (2 / 3).
  assert.ok(Math.abs(distance - 81) < 1e-12);
});

test('fit reserves symmetric safe space for asymmetric UI overlays', () => {
  assert.deepEqual(
    safeViewportFractions(1000, 1000, { top: 40, right: 10, bottom: 100, left: 20 }),
    { x: 0.96, y: 0.8 }
  );
  const unobscured = perspectiveFitDistance({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    verticalFovDegrees: 45, viewportWidth: 800, viewportHeight: 1200
  });
  const withControls = perspectiveFitDistance({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    verticalFovDegrees: 45, viewportWidth: 800, viewportHeight: 1200,
    insets: { top: 48, right: 16, bottom: 72, left: 16 }
  });
  assert.ok(withControls > unobscured);
});

test('orthographic fit uses the limiting projected axis and safe viewport', () => {
  const landscape = orthographicFitZoom({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    viewportWidth: 1200, viewportHeight: 800
  });
  const portrait = orthographicFitZoom({
    halfSize: { x: 50, y: 25, z: 6 }, direction: isometric, up,
    viewportWidth: 800, viewportHeight: 1200,
    insets: { top: 48, right: 16, bottom: 72, left: 16 }
  });
  assert.ok(portrait < landscape);
});

test('fit handles a camera direction parallel to its requested up vector', () => {
  const distance = perspectiveFitDistance({
    halfSize: { x: 10, y: 20, z: 30 },
    direction: { x: 0, y: 1, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    verticalFovDegrees: 45,
    viewportWidth: 800,
    viewportHeight: 600
  });
  assert.ok(Number.isFinite(distance) && distance > 30);
});
