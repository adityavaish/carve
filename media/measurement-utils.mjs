export function perspectiveWorldUnitsPerPixel(distance, verticalFovDegrees, viewportHeight) {
  if (!Number.isFinite(distance) || distance < 0 ||
      !Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 ||
      !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 0;
  }
  const verticalFov = verticalFovDegrees * Math.PI / 180;
  return 2 * distance * Math.tan(verticalFov / 2) / viewportHeight;
}

export function orthographicWorldUnitsPerPixel(verticalSpan, zoom, viewportHeight) {
  if (!Number.isFinite(verticalSpan) || verticalSpan <= 0 ||
      !Number.isFinite(zoom) || zoom <= 0 ||
      !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 0;
  }
  return verticalSpan / zoom / viewportHeight;
}

export function measurementInterval(worldUnitsPerPixel, targetPixels = 80) {
  if (!Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= 0 ||
      !Number.isFinite(targetPixels) || targetPixels <= 0) {
    return 1;
  }
  const targetWorldUnits = worldUnitsPerPixel * targetPixels;
  const power = 10 ** Math.floor(Math.log10(targetWorldUnits));
  const normalized = targetWorldUnits / power;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * power;
}

export function paddedMeasurementRange(minimum, maximum, padding = 0) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return { min: 0, max: 0 };
  }
  const min = Math.min(minimum, maximum, 0) - Math.max(0, padding);
  const max = Math.max(minimum, maximum, 0) + Math.max(0, padding);
  return { min, max };
}

export function measurementTickRange(minimum, maximum, step) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
      !Number.isFinite(step) || step <= 0) {
    return { first: 0, last: -1 };
  }
  const tolerance = step * 1e-9;
  return {
    first: Math.ceil((Math.min(minimum, maximum) - tolerance) / step),
    last: Math.floor((Math.max(minimum, maximum) + tolerance) / step)
  };
}

export function formatMeasuredValue(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return String(value);
  const normalized = Math.abs(value) < step * 1e-6 ? 0 : value;
  const magnitude = Math.abs(normalized);
  if (magnitude !== 0 && (magnitude >= 1e12 || magnitude < 1e-6)) {
    return normalized.toExponential(6)
      .replace(/\.0+(?=e)/, '')
      .replace(/(\.\d*?)0+(?=e)/, '$1')
      .replace('e+', 'e');
  }
  let decimals = 0;
  let scaledStep = step;
  while (decimals < 12 &&
         Math.abs(scaledStep - Math.round(scaledStep)) > Math.max(1, Math.abs(scaledStep)) * 1e-10) {
    scaledStep *= 10;
    decimals++;
  }
  const fixed = normalized.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
