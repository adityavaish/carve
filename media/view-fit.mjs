const EPSILON = 1e-9;

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!(length > EPSILON)) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cameraBasis(direction, up) {
  const backward = normalize(direction);
  if (!backward) return null;
  let right = normalize(cross(up, backward));
  if (!right) {
    const fallbackUp = Math.abs(backward.y) < 0.99
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
    right = normalize(cross(fallbackUp, backward));
  }
  return { backward, right, up: normalize(cross(backward, right)) };
}

function projectedCorners(halfSize, direction, up) {
  const basis = cameraBasis(direction, up);
  if (!basis) return null;
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = {
          x: halfSize.x * sx,
          y: halfSize.y * sy,
          z: halfSize.z * sz
        };
        corners.push({
          x: dot(corner, basis.right),
          y: dot(corner, basis.up),
          depth: dot(corner, basis.backward)
        });
      }
    }
  }
  return corners;
}

export function safeViewportFractions(width, height, insets = {}) {
  if (!(width > 0) || !(height > 0)) return { x: 1, y: 1 };
  const horizontal = Math.max(insets.left ?? 0, insets.right ?? 0, 0);
  const vertical = Math.max(insets.top ?? 0, insets.bottom ?? 0, 0);
  return {
    x: Math.max(EPSILON, (width - 2 * horizontal) / width),
    y: Math.max(EPSILON, (height - 2 * vertical) / height)
  };
}

export function perspectiveFitDistance({
  halfSize,
  direction,
  up,
  verticalFovDegrees,
  viewportWidth,
  viewportHeight,
  insets
}) {
  const corners = projectedCorners(halfSize, direction, up);
  if (!corners || !(viewportWidth > 0) || !(viewportHeight > 0)) return 0;
  const fractions = safeViewportFractions(viewportWidth, viewportHeight, insets);
  const tanY = Math.tan(verticalFovDegrees * Math.PI / 360);
  if (!(tanY > 0)) return 0;
  const tanX = tanY * viewportWidth / viewportHeight;
  let distance = 0;
  for (const corner of corners) {
    distance = Math.max(
      distance,
      corner.depth + Math.abs(corner.x) / (tanX * fractions.x),
      corner.depth + Math.abs(corner.y) / (tanY * fractions.y)
    );
  }
  return distance;
}

export function orthographicFitZoom({
  halfSize,
  direction,
  up,
  viewportWidth,
  viewportHeight,
  insets
}) {
  const corners = projectedCorners(halfSize, direction, up);
  if (!corners || !(viewportWidth > 0) || !(viewportHeight > 0)) return 1;
  const extents = corners.reduce((result, corner) => ({
    x: Math.max(result.x, Math.abs(corner.x)),
    y: Math.max(result.y, Math.abs(corner.y))
  }), { x: 0, y: 0 });
  const fractions = safeViewportFractions(viewportWidth, viewportHeight, insets);
  const aspect = viewportWidth / viewportHeight;
  const horizontalZoom = extents.x > EPSILON
    ? aspect * fractions.x / extents.x
    : Infinity;
  const verticalZoom = extents.y > EPSILON
    ? fractions.y / extents.y
    : Infinity;
  const zoom = Math.min(horizontalZoom, verticalZoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}
