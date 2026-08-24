import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewerSource = await readFile(
  new URL('../media/viewer.js', import.meta.url),
  'utf8'
);
const extensionSource = await readFile(
  new URL('../src/extension.ts', import.meta.url),
  'utf8'
);

test('every bare viewer import is represented in the webview import map', () => {
  const specifiers = [
    ...viewerSource.matchAll(/\bfrom\s+['"]([^./][^'"]*)['"]/g)
  ].map((match) => match[1]);

  assert.deepEqual(specifiers, [
    'openscad',
    'three',
    'three/addons/controls/OrbitControls.js',
    'three/addons/loaders/STLLoader.js'
  ]);

  for (const specifier of specifiers) {
    assert.match(extensionSource, new RegExp(`"${specifier.replaceAll('.', '\\.')}":`));
  }
});

test('module bootstrap failures replace the indefinite loading state', () => {
  assert.match(extensionSource, /Failed to start Carve:/);
  assert.match(extensionSource, /Carve startup timed out while loading its preview module/);
});

test('pure 2D previews use the 3D scene pipeline instead of SVG', () => {
  assert.match(viewerSource, /if \(\/not a 3D object\/i\.test\(result\.stderr\)\)/);
  assert.match(viewerSource, /const sceneResult = await runCsgScenePreview\(code\)/);
  assert.match(viewerSource, /wrap2dForPreview\(branch\.source/);
  assert.match(viewerSource, /function without3dProbeNoise\(/);
  assert.doesNotMatch(viewerSource, /PREVIEW_2D_FORMAT|show2d|svgPreview/);
  assert.doesNotMatch(extensionSource, /carve-preview-format/);
});

test('colored previews use one WRL render before the CSG/STL fallback', () => {
  const runPreview = viewerSource.match(
    /async function runPreview\(code\) \{([\s\S]*?)\n\}/
  )?.[1];
  assert.ok(runPreview);
  assert.ok(
    runPreview.indexOf('runOpenscad(code, PREVIEW_COLOR_FORMAT)') <
    runPreview.indexOf('enhancedScenePreview(code, PREVIEW_3D_FORMAT)')
  );
  assert.ok(
    runPreview.indexOf('enhancedScenePreview(code, PREVIEW_3D_FORMAT)') <
    runPreview.indexOf('runOpenscad(code, PREVIEW_3D_FORMAT)')
  );
  assert.match(viewerSource, /groupCsgPreviewBranches\(previewBranches\)/);
});

test('native OpenSCAD previews bypass WASM and retain a WASM fallback', () => {
  assert.match(extensionSource, /findNativeOpenScad/);
  assert.match(extensionSource, /renderNativeWrl/);
  assert.match(extensionSource, /nativeRenderCacheKey/);
  assert.match(extensionSource, /nativePreviewCache\.get/);
  assert.match(extensionSource, /nativePreviewCache\.set/);
  assert.match(extensionSource, /type: 'renderStart'/);
  assert.match(extensionSource, /type: 'nativeRender'/);
  assert.match(extensionSource, /backend !== 'wasm'/);
  assert.match(viewerSource, /function showNativeRender\(msg\)/);
  assert.match(viewerSource, /Native OpenSCAD/);
  assert.match(viewerSource, /Native cache/);
  assert.match(viewerSource, /else if \(msg\?\.type === 'render'\) renderToScene/);
});

test('every WASM instance receives output hooks during construction', () => {
  assert.equal(viewerSource.match(/print: capture\.print,/g)?.length, 2);
  assert.equal(viewerSource.match(/printErr: capture\.printErr/g)?.length, 2);
  assert.doesNotMatch(viewerSource, /Module\.printErr\s*=/);
});

test('host fonts are installed into every OpenSCAD virtual filesystem', () => {
  assert.match(extensionSource, /fontsForDocument/);
  assert.match(viewerSource, /function installFonts\(M\)/);
  assert.match(viewerSource, /\/fonts\/fonts\.conf/);
  assert.match(viewerSource, /installFonts\(Module\)/);
  assert.match(viewerSource, /installFonts\(M\)/);
  assert.match(viewerSource, /registerFonts\(msg\?\.fonts\)/);
});

test('relative import files are copied beside the SCAD file in WASM', () => {
  assert.match(extensionSource, /function referencedFiles\(/);
  assert.match(extensionSource, /filesForDocument\(doc, code\)/);
  assert.match(extensionSource, /filesForDocument\(editor\.document, editor\.document\.getText\(\)\)/);
  assert.match(viewerSource, /function installDocumentFiles\(M\)/);
  assert.match(viewerSource, /M\.FS\.writeFile\(virtualPath, data\)/);
  assert.match(viewerSource, /Module\.FS\.writeFile\('\/input\/in\.scad', code\)/);
  assert.match(viewerSource, /installDocumentFiles\(Module\)/);
});

test('the preview exposes captured compiler output in a collapsible console', () => {
  assert.match(extensionSource, /id="consoleToggle"/);
  assert.match(extensionSource, /id="compileConsole"/);
  assert.match(extensionSource, /id="compileLog"/);
  assert.match(viewerSource, /function setCompileLog\(/);
  assert.match(viewerSource, /log: capturedLog\(\)/);
  assert.doesNotMatch(viewerSource, /setConsoleOpen\(true\)/);
  assert.match(viewerSource, /`Error \(\$\{ms\} ms\)\\n\$\{result\.stderr/);
});

test('the webview has a single Three.js viewer for both 2D and 3D geometry', () => {
  assert.match(extensionSource, /<canvas id="viewer"><\/canvas>/);
  assert.doesNotMatch(extensionSource, /viewer2d|svgPreview|fit2d/);
  assert.match(viewerSource, /const material2d = new THREE\.MeshStandardMaterial/);
  assert.match(viewerSource, /2D geometry in 3D view/);
});

test('the 3D viewer preserves its viewpoint between renders and supports refitting', () => {
  assert.match(viewerSource, /let has3dViewpoint = false/);
  assert.equal(viewerSource.match(/if \(!has3dViewpoint\) fit3dPreview\(\)/g)?.length, 3);
  assert.match(viewerSource, /fit3dButton\.addEventListener\('click', fit3dPreview\)/);
  assert.match(viewerSource, /canvas\.addEventListener\('dblclick', fit3dPreview\)/);
  assert.match(extensionSource, /id="fit3d"/);
});

test('the 3D viewer offers positive and negative plane-aligned view presets', () => {
  assert.match(extensionSource, /id="viewPresets3d"/);
  assert.deepEqual(
    [...extensionSource.matchAll(/data-plane-view="([+-][XYZ])"/g)].map((match) => match[1]),
    ['+X', '+Y', '+Z', '-X', '-Y', '-Z']
  );
  assert.match(extensionSource, /grid-template-columns: repeat\(3, auto\)/);
  assert.match(viewerSource, /const PLANE_VIEWS =/);
  for (const view of ['+X', '-X', '+Y', '-Y', '+Z', '-Z']) {
    assert.match(viewerSource, new RegExp(`'\\${view}'`));
  }
  assert.match(viewerSource, /function setPlaneView\(plane\)/);
  assert.match(viewerSource, /button\.dataset\.planeView/);
});

test('the 3D viewer toggles between perspective and isometric projection', () => {
  assert.match(extensionSource, /id="projection3d"/);
  assert.match(viewerSource, /new THREE\.OrthographicCamera/);
  assert.match(viewerSource, /function setOrthographicProjection\(enabled\)/);
  assert.match(viewerSource, /controls\.object = camera/);
  assert.match(viewerSource, /projection3dButton\.addEventListener\('click', toggle3dProjection\)/);
  const toggleBody = viewerSource.match(/function toggle3dProjection\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.doesNotMatch(toggleBody, /fit3dPreview/);
});

test('the 3D viewer uses the OpenSCAD light background and balanced lighting', () => {
  assert.match(viewerSource, /renderer\.outputColorSpace = THREE\.SRGBColorSpace/);
  assert.match(viewerSource, /renderer\.toneMapping = THREE\.ACESFilmicToneMapping/);
  assert.match(viewerSource, /scene\.background = new THREE\.Color\(0xffffe5\)/);
  assert.match(viewerSource, /new THREE\.HemisphereLight/);
  assert.equal(viewerSource.match(/new THREE\.DirectionalLight/g)?.length, 3);
});

test('the 3D measurement layer uses OpenSCAD space and can be hidden', () => {
  assert.match(viewerSource, /previewGroup\.add\(modelGroup, measurementGroup\)/);
  assert.match(viewerSource, /new THREE\.LineSegments\(geometry, material\)/);
  assert.match(viewerSource, /new THREE\.SpriteMaterial/);
  assert.match(viewerSource, /controls\.addEventListener\('change', refresh3dMeasurements\)/);
  assert.match(viewerSource, /perspectiveWorldUnitsPerPixel/);
  assert.match(viewerSource, /const axisNameOffset = direction\.clone\(\)\.multiplyScalar\(36\)/);
  assert.match(viewerSource, /addScaledVector\(LABEL_OFFSETS\[axis\], 32\)/);
  assert.match(extensionSource, /id="axes3d"/);
});

test('empty geometry is a neutral preview state and localization noise is filtered', () => {
  assert.match(viewerSource, /function cleanStderr\(/);
  assert.match(viewerSource, /Could not initialize localization/);
  assert.match(viewerSource, /function isEmptyTopLevel\(/);
  assert.match(viewerSource, /!\/\^ERROR:\/mi\.test\(stderr\)/);
  assert.match(viewerSource, /empty: true/);
  assert.match(viewerSource, /function showEmpty\(/);
  assert.match(extensionSource, /id="emptyPreview"/);
});

test('mixed 2D and 3D geometry is detected before a partial preview is shown', () => {
  assert.match(viewerSource, /function isMixedDimensions\(/);
  assert.match(viewerSource, /mixedDimensions: true/);
  assert.match(viewerSource, /function showPlaceholder\(/);
  assert.match(viewerSource, /incompatible 2D and 3D operations/);
});

test('independent mixed roots use a combined hybrid preview', () => {
  assert.match(viewerSource, /mayContainMixedGeometry\(code\)/);
  assert.match(viewerSource, /function runHybridPreview\(/);
  assert.match(viewerSource, /splitCsgForPreview\(/);
  assert.match(viewerSource, /wrap2dForPreview\(/);
  assert.match(viewerSource, /function showHybrid\(/);
  assert.match(viewerSource, /Hybrid 2D \+ 3D/);
});

test('evaluated OpenSCAD colors become per-part Three.js materials', () => {
  assert.match(viewerSource, /mayContainColor\(code\)/);
  assert.match(viewerSource, /splitCsgForPreview\(/);
  assert.match(viewerSource, /function materialForPart\(/);
  assert.match(viewerSource, /material\.color\.setRGB\(r, g, b, THREE\.SRGBColorSpace\)/);
  assert.match(viewerSource, /material\.opacity = opacity/);
  assert.match(viewerSource, /material\.depthWrite = opacity >= 1/);
});
