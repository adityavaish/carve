// Parser for the compact VRML 2 output emitted by OpenSCAD's WRL exporter.
// OpenSCAD writes one IndexedFaceSet with a per-face colorIndex. Expanding the
// indexed faces here lets Three.js use ordinary vertex colors without another
// geometry evaluation.

function field(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`OpenSCAD WRL output is missing ${label}.`);
  return match[1];
}

function numbers(source) {
  return source
    .replace(/#[^\n\r]*/g, ' ')
    .match(/[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g)
    ?.map(Number) ?? [];
}

export function parseOpenScadWrl(source) {
  const text = String(source ?? '');
  if (!/^\s*#VRML\s+V2\.0\s+utf8/m.test(text)) {
    throw new Error('OpenSCAD did not produce VRML 2 output.');
  }

  const coordinates = numbers(field(
    text,
    /coord\s+Coordinate\s*\{\s*point\s*\[([\s\S]*?)\]\s*\}/i,
    'coordinates'
  ));
  const coordinateIndices = numbers(field(
    text,
    /coordIndex\s*\[([\s\S]*?)\]/i,
    'face indices'
  ));
  if (coordinates.length % 3 !== 0) {
    throw new Error('OpenSCAD WRL output has incomplete coordinates.');
  }

  const paletteMatch = text.match(/color\s+Color\s*\{\s*color\s*\[([\s\S]*?)\]\s*\}/i);
  const palette = paletteMatch ? numbers(paletteMatch[1]) : [];
  const colorIndicesMatch = text.match(/colorIndex\s*\[([\s\S]*?)\]/i);
  const colorIndices = colorIndicesMatch ? numbers(colorIndicesMatch[1]) : [];
  const diffuseMatch = text.match(/diffuseColor\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/i);
  const defaultColor = diffuseMatch
    ? diffuseMatch.slice(1, 4).map(Number)
    : [0.97647, 0.843137, 0.172549];

  const positions = [];
  const colors = [];
  let face = [];
  let faceNumber = 0;
  let triangleCount = 0;

  const emitFace = () => {
    if (face.length < 3) {
      face = [];
      faceNumber++;
      return;
    }
    const colorIndex = colorIndices[faceNumber];
    const colorOffset = Number.isInteger(colorIndex) ? colorIndex * 3 : -1;
    const color = colorOffset >= 0 && colorOffset + 2 < palette.length
      ? palette.slice(colorOffset, colorOffset + 3)
      : defaultColor;
    for (let index = 1; index + 1 < face.length; index++) {
      for (const vertexIndex of [face[0], face[index], face[index + 1]]) {
        const offset = vertexIndex * 3;
        if (!Number.isInteger(vertexIndex) || offset < 0 || offset + 2 >= coordinates.length) {
          throw new Error(`OpenSCAD WRL output references invalid vertex ${vertexIndex}.`);
        }
        positions.push(coordinates[offset], coordinates[offset + 1], coordinates[offset + 2]);
        colors.push(color[0], color[1], color[2]);
      }
      triangleCount++;
    }
    face = [];
    faceNumber++;
  };

  for (const index of coordinateIndices) {
    if (index === -1) emitFace();
    else face.push(index);
  }
  if (face.length) emitFace();
  if (triangleCount === 0) throw new Error('OpenSCAD WRL output contains no faces.');

  const materialCount = new Set(colorIndices).size || 1;
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    triangleCount,
    materialCount
  };
}
