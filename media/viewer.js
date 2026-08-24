// @ts-nocheck
// Carve webview viewer: drives the OpenSCAD WASM module + Three.js mesh viewer.
// Loaded from media/viewer.js inside a VS Code Webview.

import OpenSCAD from 'openscad';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
  groupCsgPreviewBranches,
  mayContainColor,
  mayContainMixedGeometry,
  splitCsgForPreview,
  wrap2dForPreview
} from './csg-preview.mjs';
import {
  formatMeasuredValue,
  measurementInterval,
  measurementTickRange,
  orthographicWorldUnitsPerPixel,
  paddedMeasurementRange,
  perspectiveWorldUnitsPerPixel
} from './measurement-utils.mjs';
import { orthographicFitZoom, perspectiveFitDistance } from './view-fit.mjs';
import { parseOpenScadWrl } from './wrl-preview.mjs';

// Keep the preview-format selection in this entry module. VS Code webviews
// resolve the import map before executing any module code, so an unresolved
// helper import prevents even the WASM error handler from running.
const PREVIEW_3D_FORMAT = 'binstl';
const PREVIEW_CSG_FORMAT = 'csg';
const PREVIEW_HYBRID_FORMAT = 'hybrid';
const PREVIEW_SCENE_FORMAT = 'scene';
const PREVIEW_COLOR_FORMAT = 'wrl';
const HYBRID_2D_THICKNESS = 0.01;

function cleanStderr(stderr) {
  return String(stderr ?? '')
    .split('\n')
    .filter((line) => !/Could not initialize localization\s+\(application path is ['"]\/['"]\)\.?/i.test(line))
    .join('\n')
    .trim();
}

function isEmptyTopLevel(stderr) {
  return /Current top level object is empty/i.test(stderr) && !/^ERROR:/mi.test(stderr);
}

function isMixedDimensions(stderr) {
  return /Mixing 2D and 3D objects is not supported/i.test(stderr);
}

function without3dProbeNoise(output) {
  return String(output ?? '')
    .split('\n')
    .filter((line) => !/Current top level object is not a 3D object/i.test(line))
    .join('\n')
    .trim();
}

const vscode = acquireVsCodeApi();
const $status = document.getElementById('status');
const canvas = document.getElementById('viewer');
const emptyPreview = document.getElementById('emptyPreview');
const fit3dButton = document.getElementById('fit3d');
const axes3dButton = document.getElementById('axes3d');
const viewPresets3d = document.getElementById('viewPresets3d');
const planeViewButtons = document.querySelectorAll('[data-plane-view]');
const projection3dButton = document.getElementById('projection3d');
const consoleToggle = document.getElementById('consoleToggle');
const compileConsole = document.getElementById('compileConsole');
const compileLog = document.getElementById('compileLog');

const setStatus = (text, isError = false) => {
  $status.textContent = text;
  $status.classList.toggle('error', !!isError);
};

function setConsoleOpen(open) {
  compileConsole.hidden = !open;
  consoleToggle.setAttribute('aria-expanded', String(open));
}

function setCompileLog(text) {
  const output = String(text ?? '').trim();
  const hasProblems = /^(?:ERROR|WARNING|TRACE):/m.test(output);
  compileLog.textContent = output || 'OpenSCAD produced no compiler output.';
  consoleToggle.classList.toggle('has-problems', hasProblems);
  consoleToggle.textContent = hasProblems ? 'Compilation log \u26a0' : 'Compilation log';
}

consoleToggle.addEventListener('click', () => setConsoleOpen(compileConsole.hidden));

function createOutputCapture() {
  const out = [];
  const err = [];
  return {
    print: (s) => out.push(s),
    printErr: (s) => err.push(s),
    stdout: () => out.join('\n'),
    stderr: () => err.join('\n'),
    reset: () => { out.length = 0; err.length = 0; }
  };
}

function capturedLog() {
  return [capture.stdout().trim(), cleanStderr(capture.stderr())].filter(Boolean).join('\n');
}

setStatus('Loading openscad.wasm\u2026');
let wasmBinary;
let capture;
let Module; // current instance, replaced per render
const availableFonts = new Map();

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function registerFonts(fonts = []) {
  for (const font of fonts) {
    if (font?.name && font?.data && !availableFonts.has(font.name)) {
      availableFonts.set(font.name, decodeBase64(font.data));
    }
  }
}

function installFonts(M) {
  if (availableFonts.size === 0) return;
  M.FS.mkdirTree('/fonts');
  M.FS.writeFile('/fonts/fonts.conf', `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>/fonts</dir><cachedir>/tmp/fontconfig-cache</cachedir></fontconfig>`);
  let index = 0;
  for (const [name, data] of availableFonts) {
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    M.FS.writeFile(`/fonts/${index++}-${safeName}`, data);
  }
}
try {
  const wasmUrl = new URL(import.meta.resolve('openscad-wasm'));
  wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  capture = createOutputCapture();
  // Eager-instantiate once so the first render is fast.
  Module = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    locateFile: () => wasmUrl.toString(),
    print: capture.print,
    printErr: capture.printErr
  });
  setStatus('Ready.');
  vscode.postMessage({ type: 'ready' });
} catch (e) {
  setStatus('Failed to load OpenSCAD WASM: ' + e.message, true);
  vscode.postMessage({ type: 'rendered', success: false, stderr: String(e) });
  throw e;
}

async function freshModule() {
  const wasmUrl = new URL(import.meta.resolve('openscad-wasm'));
  capture = createOutputCapture();
  const M = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    locateFile: () => wasmUrl.toString(),
    print: capture.print,
    printErr: capture.printErr
  });
  installFonts(M);
  return M;
}

// --- Three.js scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
// Match OpenSCAD's classic light viewport. The warm ivory keeps white parts
// distinct from the canvas without changing their material color.
scene.background = new THREE.Color(0xffffe5);
const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
let camera = perspectiveCamera;
camera.position.set(80, 80, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// A neutral studio rig keeps gray OpenSCAD parts legible from every orbit
// angle while preserving enough directionality to reveal recesses and edges.
scene.add(new THREE.HemisphereLight(0xffffff, 0x8b92a3, 1.35));
const keyLight = new THREE.DirectionalLight(0xfff8ed, 2.4);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xdde8ff, 1.1);
fillLight.position.set(-4, 2, 3);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
rimLight.position.set(2, 4, -5);
scene.add(rimLight);
const previewGroup = new THREE.Group();
previewGroup.rotation.x = -Math.PI / 2; // OpenSCAD Z-up -> Three.js Y-up
scene.add(previewGroup);
const modelGroup = new THREE.Group();
const measurementGroup = new THREE.Group();
measurementGroup.name = 'OpenSCAD measurements';
previewGroup.add(modelGroup, measurementGroup);

const AXIS_COLORS = [0xe05252, 0x45b978, 0x4d83e6];
const AXIS_NAMES = ['X', 'Y', 'Z'];
const AXIS_DIRECTIONS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1)
];
const LABEL_OFFSETS = [
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(1, 0, 0)
];
let measurementBounds = null;
let measurementKey = '';
let measurementLabels = [];
let axes3dVisible = true;

let has3dViewpoint = false;
const material3d = new THREE.MeshStandardMaterial({
  color: 0xf9b233, metalness: 0, roughness: 0.72, flatShading: true
});
const material2d = new THREE.MeshStandardMaterial({
  color: 0xffd166,
  metalness: 0,
  roughness: 0.75,
  flatShading: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
    renderer.setSize(w, h, false);
    perspectiveCamera.aspect = w / h;
    perspectiveCamera.updateProjectionMatrix();
    orthographicCamera.left = -w / h;
    orthographicCamera.right = w / h;
    orthographicCamera.updateProjectionMatrix();
    refresh3dMeasurements();
  }
}
function loop() {
  requestAnimationFrame(loop);
  resize();
  controls.update();
  renderer.render(scene, camera);
}
loop();

function updateMeasurementBounds() {
  const bounds = new THREE.Box3();
  for (const child of modelGroup.children) {
    if (!child.geometry) continue;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    child.updateMatrix();
    bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
  }
  measurementBounds = bounds.isEmpty() ? null : bounds;
  measurementKey = '';
}

function disposeMeasurementLayer() {
  for (const child of [...measurementGroup.children]) {
    measurementGroup.remove(child);
    child.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material.map?.dispose();
          material.dispose();
        }
      }
    });
  }
  measurementLabels = [];
}

function createMeasurementLabel(text, color, anchor, offsetDirection, offsetPixels = 12, bold = false) {
  const fontSize = 30;
  const padding = 8;
  const labelCanvas = document.createElement('canvas');
  const context = labelCanvas.getContext('2d');
  context.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
  labelCanvas.width = Math.ceil(context.measureText(text).width) + padding * 2;
  labelCanvas.height = fontSize + padding * 2;
  context.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 4;
  context.strokeStyle = 'rgba(35, 35, 48, 0.95)';
  context.strokeText(text, labelCanvas.width / 2, labelCanvas.height / 2);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.userData.measurementLabel = {
    anchor: anchor.clone(),
    offsetDirection: offsetDirection.clone(),
    offsetPixels,
    widthPixels: labelCanvas.width * 0.42,
    heightPixels: labelCanvas.height * 0.42
  };
  measurementGroup.add(sprite);
  measurementLabels.push(sprite);
}

function pushColoredSegment(positions, colors, from, to, color) {
  positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  const threeColor = new THREE.Color(color);
  colors.push(threeColor.r, threeColor.g, threeColor.b, threeColor.r, threeColor.g, threeColor.b);
}

function measurementRanges(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  let extent = Math.max(size.x, size.y, size.z);
  if (!(extent > 0)) {
    extent = Math.max(
      Math.abs(bounds.min.x), Math.abs(bounds.max.x),
      Math.abs(bounds.min.y), Math.abs(bounds.max.y),
      Math.abs(bounds.min.z), Math.abs(bounds.max.z),
      1
    );
  }
  const padding = extent * 0.08;
  return [
    paddedMeasurementRange(bounds.min.x, bounds.max.x, padding),
    paddedMeasurementRange(bounds.min.y, bounds.max.y, padding),
    paddedMeasurementRange(bounds.min.z, bounds.max.z, padding)
  ];
}

function worldUnitsPerPixel3d() {
  if (camera.isOrthographicCamera) {
    return orthographicWorldUnitsPerPixel(
      camera.top - camera.bottom, camera.zoom, canvas.clientHeight
    );
  }
  return perspectiveWorldUnitsPerPixel(
    camera.position.distanceTo(controls.target), camera.fov, canvas.clientHeight
  );
}

function rebuild3dMeasurements(force = false) {
  if (!measurementBounds || !axes3dVisible) {
    if (force || measurementGroup.children.length) disposeMeasurementLayer();
    measurementKey = '';
    return;
  }
  const unitsPerPixel = worldUnitsPerPixel3d();
  if (!(unitsPerPixel > 0)) return;
  const ranges = measurementRanges(measurementBounds);
  let step = measurementInterval(unitsPerPixel, 80);
  const largestSpan = Math.max(...ranges.map((range) => range.max - range.min));
  while (largestSpan / step > 120) {
    step = measurementInterval(step * 1.01, 1);
  }
  const key = JSON.stringify({ step, ranges });
  if (!force && key === measurementKey) return;

  disposeMeasurementLayer();
  measurementKey = key;
  const positions = [];
  const colors = [];
  const tickRadius = unitsPerPixel * 5;

  for (let axis = 0; axis < 3; axis++) {
    const direction = AXIS_DIRECTIONS[axis];
    const range = ranges[axis];
    const from = direction.clone().multiplyScalar(range.min);
    const to = direction.clone().multiplyScalar(range.max);
    pushColoredSegment(positions, colors, from, to, AXIS_COLORS[axis]);

    const ticks = measurementTickRange(range.min, range.max, step);
    for (let tick = ticks.first; tick <= ticks.last; tick++) {
      const value = tick * step;
      if (Math.abs(value) < step * 1e-9) continue;
      const anchor = direction.clone().multiplyScalar(value);
      const tickDirection = LABEL_OFFSETS[axis];
      pushColoredSegment(
        positions,
        colors,
        anchor.clone().addScaledVector(tickDirection, -tickRadius),
        anchor.clone().addScaledVector(tickDirection, tickRadius),
        AXIS_COLORS[axis]
      );
      createMeasurementLabel(
        formatMeasuredValue(value, step), AXIS_COLORS[axis], anchor, LABEL_OFFSETS[axis]
      );
    }
    const axisNameOffset = direction.clone().multiplyScalar(36)
      .addScaledVector(LABEL_OFFSETS[axis], 32);
    createMeasurementLabel(
      AXIS_NAMES[axis], AXIS_COLORS[axis], to, axisNameOffset, 1, true
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88 });
  measurementGroup.add(new THREE.LineSegments(geometry, material));
  createMeasurementLabel(
    '0', 0xdddddd, new THREE.Vector3(), new THREE.Vector3(1, 1, 0).normalize(), 10
  );
}

function refresh3dMeasurements() {
  if (!axes3dVisible || !measurementBounds || canvas.hidden) return;
  rebuild3dMeasurements();
  const unitsPerPixel = worldUnitsPerPixel3d();
  if (!(unitsPerPixel > 0)) return;
  for (const sprite of measurementLabels) {
    const label = sprite.userData.measurementLabel;
    sprite.position.copy(label.anchor).addScaledVector(
      label.offsetDirection, label.offsetPixels * unitsPerPixel
    );
    sprite.scale.set(label.widthPixels * unitsPerPixel, label.heightPixels * unitsPerPixel, 1);
  }
}

controls.addEventListener('change', refresh3dMeasurements);

// --- Render pipeline ------------------------------------------------------
let pending = 0;
let hostRenderGeneration = 0;
let moduleUsed = false; // true once we've called callMain on `Module`
let documentFiles = [];

function registerDocumentFiles(files) {
  documentFiles = Array.isArray(files) ? files : [];
}

function installDocumentFiles(M) {
  M.FS.mkdirTree('/input');
  for (const file of documentFiles) {
    if (!file?.name || !file?.data) continue;
    const relativeName = String(file.name).replaceAll('\\', '/').replace(/^\/+/, '');
    const virtualPath = `/input/${relativeName}`;
    const slash = virtualPath.lastIndexOf('/');
    if (slash > 0) M.FS.mkdirTree(virtualPath.slice(0, slash));
    const binary = atob(file.data);
    const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    M.FS.writeFile(virtualPath, data);
  }
}

async function runOpenscad(code, format) {
  // OpenSCAD's main() leaves C++ static state behind that prevents a clean
  // second call. Re-instantiate the module between renders.
  if (moduleUsed) {
    Module = await freshModule();
  }
  installFonts(Module);
  installDocumentFiles(Module);
  moduleUsed = true;
  capture.reset();
  try { Module.FS.writeFile('/input/in.scad', code); } catch (e) {
    const stderr = 'FS.writeFile failed: ' + e.message;
    return { success: false, stderr, log: stderr };
  }
  let rc;
  try {
    rc = Module.callMain(['/input/in.scad', '-o', '/out', '--export-format=' + format]);
  } catch (e) {
    const stderr = cleanStderr(capture.stderr()) || String(e);
    return { success: false, stderr, log: capturedLog() || stderr };
  }
  if (rc !== 0 && rc !== undefined) {
    const stderr = cleanStderr(capture.stderr()) || `OpenSCAD exited ${rc}`;
    return { success: false, stderr, log: capturedLog() || stderr };
  }
  let data;
  try { data = Module.FS.readFile('/out'); } catch (e) {
    const stderr = cleanStderr(capture.stderr()) || 'No output produced';
    return { success: false, stderr, log: capturedLog() || stderr };
  }
  return {
    success: true,
    data,
    stderr: cleanStderr(capture.stderr()),
    log: capturedLog()
  };
}

async function runCsgScenePreview(code, requireMixedDimensions = false) {
  const csgResult = await runOpenscad(code, PREVIEW_CSG_FORMAT);
  if (!csgResult.success) {
    return { ...csgResult, format: PREVIEW_SCENE_FORMAT };
  }

  let previewBranches;
  try {
    previewBranches = splitCsgForPreview(new TextDecoder().decode(csgResult.data));
  } catch (error) {
    return { success: false, stderr: String(error), format: PREVIEW_SCENE_FORMAT };
  }

  async function renderBranch(branch) {
    const stlResult = await runOpenscad(branch.source, PREVIEW_3D_FORMAT);
    if (stlResult.success) {
      return {
        success: true,
        parts: [{ dimension: 3, data: stlResult.data, color: branch.color }]
      };
    }
    if (isMixedDimensions(stlResult.stderr)) {
      return {
        success: false,
        mixedDimensions: true,
        stderr: [
          'A single top-level branch still mixes 2D and 3D operations.',
          'Move the 2D profile and 3D model into independent top-level branches.',
          '',
          stlResult.stderr
        ].join('\n'),
        format: PREVIEW_HYBRID_FORMAT,
        parts: []
      };
    }
    if (!isEmptyTopLevel(stlResult.stderr) && !/not a 3D object/i.test(stlResult.stderr)) {
      return { ...stlResult, format: PREVIEW_SCENE_FORMAT, parts: [] };
    }

    const flatResult = await runOpenscad(
      wrap2dForPreview(branch.source, HYBRID_2D_THICKNESS),
      PREVIEW_3D_FORMAT
    );
    if (!flatResult.success) {
      if (isEmptyTopLevel(flatResult.stderr)) return { success: true, parts: [] };
      return { ...flatResult, format: PREVIEW_SCENE_FORMAT, parts: [] };
    }
    return {
      success: true,
      parts: [{ dimension: 2, data: flatResult.data, color: branch.color }]
    };
  }

  const parts = [];
  for (const group of groupCsgPreviewBranches(previewBranches)) {
    let branchResults = [await renderBranch(group)];
    if (!branchResults[0].success && group.branches.length > 1) {
      branchResults = [];
      for (const branch of group.branches) branchResults.push(await renderBranch(branch));
    }
    for (const branchResult of branchResults) {
      if (!branchResult.success) return branchResult;
      parts.push(...branchResult.parts);
    }
  }

  const dimensions = new Set(parts.map((part) => part.dimension));
  const isHybrid = dimensions.has(2) && dimensions.has(3);
  if (requireMixedDimensions && !isHybrid) {
    return {
      success: false,
      stderr: 'OpenSCAD reported mixed geometry, but Carve could not isolate both dimensions.',
      format: PREVIEW_HYBRID_FORMAT
    };
  }
  return {
    success: true,
    parts,
    hasColor: parts.some((part) => part.color),
    stderr: csgResult.stderr,
    log: csgResult.log,
    format: isHybrid ? PREVIEW_HYBRID_FORMAT : PREVIEW_SCENE_FORMAT
  };
}

function runHybridPreview(code) {
  return runCsgScenePreview(code, true);
}

async function enhancedScenePreview(code, format) {
  const mixedHint = mayContainMixedGeometry(code);
  const colorHint = format === PREVIEW_3D_FORMAT && mayContainColor(code);
  if (!mixedHint && !colorHint) return undefined;

  const sceneResult = await runCsgScenePreview(code);
  if (sceneResult.mixedDimensions) return sceneResult;
  if (!sceneResult.success) return undefined;
  if (sceneResult.format === PREVIEW_HYBRID_FORMAT) return sceneResult;
  if (colorHint && sceneResult.hasColor) return sceneResult;
  return undefined;
}

async function runPreview(code) {
  // WRL is the only color-capable mesh export in the bundled OpenSCAD build.
  // It preserves final Boolean geometry and per-face colors in one evaluation,
  // avoiding a CSG export followed by one complete STL render per material.
  if (mayContainColor(code)) {
    const colorResult = await runOpenscad(code, PREVIEW_COLOR_FORMAT);
    if (colorResult.success) {
      try {
        const parsed = parseOpenScadWrl(new TextDecoder().decode(colorResult.data));
        return { ...colorResult, parsed, format: PREVIEW_COLOR_FORMAT };
      } catch {
        // Keep the existing CSG/STL route as a compatibility fallback if a
        // future OpenSCAD build changes its WRL dialect.
      }
    }
  }
  // Color and likely mixed-dimension sources need normalized CSG in order to
  // preserve their scene structure. Try that route first so a successful
  // scene preview does not pay for a complete STL that would be discarded.
  const sceneResult = await enhancedScenePreview(code, PREVIEW_3D_FORMAT);
  if (sceneResult) return sceneResult;

  const result = await runOpenscad(code, PREVIEW_3D_FORMAT);
  if (isMixedDimensions(result.stderr)) {
    return { ...await runHybridPreview(code), log: result.log };
  }
  if (result.success) {
    return { ...result, format: PREVIEW_3D_FORMAT };
  }
  if (isEmptyTopLevel(result.stderr)) {
    return { ...result, success: true, empty: true, format: PREVIEW_3D_FORMAT };
  }

  if (/not a 3D object/i.test(result.stderr)) {
    const sceneResult = await runCsgScenePreview(code);
    if (sceneResult.success || sceneResult.mixedDimensions) {
      return {
        ...sceneResult,
        stderr: without3dProbeNoise(result.stderr),
        log: without3dProbeNoise(result.log)
      };
    }
  }
  return { ...result, format: PREVIEW_3D_FORMAT };
}

function clear3dPreview() {
  for (const child of [...modelGroup.children]) {
    modelGroup.remove(child);
    child.geometry?.dispose();
    if (child.material !== material2d && child.material !== material3d) {
      child.material?.dispose();
    }
  }
  measurementBounds = null;
  rebuild3dMeasurements(true);
}

function showPlaceholder(message) {
  clear3dPreview();
  canvas.hidden = true;
  fit3dButton.hidden = true;
  axes3dButton.hidden = true;
  viewPresets3d.hidden = true;
  projection3dButton.hidden = true;
  emptyPreview.textContent = message;
  emptyPreview.hidden = false;
}

function showEmpty() {
  showPlaceholder('No top-level geometry to preview');
}

function show3d(stl) {
  emptyPreview.hidden = true;
  canvas.hidden = false;
  fit3dButton.hidden = false;
  axes3dButton.hidden = false;
  viewPresets3d.hidden = false;
  projection3dButton.hidden = false;
  clear3dPreview();
  const geom = parseStl(stl);
  modelGroup.add(new THREE.Mesh(geom, material3d));
  updateMeasurementBounds();
  if (!has3dViewpoint) fit3dPreview();
  else refresh3dMeasurements();
  return geom.attributes.position.count / 3;
}

function showWrl(parsed) {
  emptyPreview.hidden = true;
  canvas.hidden = false;
  fit3dButton.hidden = false;
  axes3dButton.hidden = false;
  viewPresets3d.hidden = false;
  projection3dButton.hidden = false;
  clear3dPreview();

  const linearColors = parsed.colors.slice();
  const color = new THREE.Color();
  for (let offset = 0; offset < linearColors.length; offset += 3) {
    color.setRGB(
      linearColors[offset], linearColors[offset + 1], linearColors[offset + 2],
      THREE.SRGBColorSpace
    );
    linearColors[offset] = color.r;
    linearColors[offset + 1] = color.g;
    linearColors[offset + 2] = color.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(linearColors, 3));
  geom.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0, roughness: 0.72, flatShading: true
  });
  modelGroup.add(new THREE.Mesh(geom, material));
  updateMeasurementBounds();
  if (!has3dViewpoint) fit3dPreview();
  else refresh3dMeasurements();
  return parsed;
}

function materialForPart(part) {
  const baseMaterial = part.dimension === 2 ? material2d : material3d;
  if (!part.color) return baseMaterial;

  const material = baseMaterial.clone();
  const r = THREE.MathUtils.clamp(part.color.r, 0, 1);
  const g = THREE.MathUtils.clamp(part.color.g, 0, 1);
  const b = THREE.MathUtils.clamp(part.color.b, 0, 1);
  const opacity = THREE.MathUtils.clamp(part.color.a, 0, 1);
  material.color.setRGB(r, g, b, THREE.SRGBColorSpace);
  material.opacity = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity >= 1;
  return material;
}

function parseStl(stl) {
  const geom = new STLLoader().parse(
    stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength)
  );
  geom.computeVertexNormals();
  return geom;
}

const FIT_PADDING_PIXELS = 16;

function fitViewportInsets() {
  const canvasRect = canvas.getBoundingClientRect();
  let top = FIT_PADDING_PIXELS;
  let bottom = FIT_PADDING_PIXELS;
  const statusRect = $status.getBoundingClientRect();
  if (statusRect.height > 0) {
    top = Math.max(top, statusRect.bottom - canvasRect.top + 8);
  }
  for (const element of [
    consoleToggle, axes3dButton, viewPresets3d, projection3dButton, fit3dButton
  ]) {
    if (element.hidden) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 0) {
      bottom = Math.max(bottom, canvasRect.bottom - rect.top + 8);
    }
  }
  return { top, right: FIT_PADDING_PIXELS, bottom, left: FIT_PADDING_PIXELS };
}

function frame3dPreview(direction, up = new THREE.Vector3(0, 1, 0)) {
  const bounds = new THREE.Box3().setFromObject(modelGroup);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const halfSize = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const radius = Math.max(1, halfSize.length());
  const normalizedDirection = direction.clone().normalize();
  const fit = {
    halfSize,
    direction: normalizedDirection,
    up,
    viewportWidth: canvas.clientWidth,
    viewportHeight: canvas.clientHeight,
    insets: fitViewportInsets()
  };
  camera.up.copy(up);
  const distance = Math.max(radius * 1.05, perspectiveFitDistance({
    ...fit,
    verticalFovDegrees: perspectiveCamera.fov
  }));
  camera.position.copy(center).addScaledVector(normalizedDirection, distance);
  if (camera.isOrthographicCamera) {
    camera.zoom = orthographicFitZoom(fit);
  }
  camera.near = Math.max(0.01, radius / 1000);
  camera.far = Math.max(10000, radius * 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  has3dViewpoint = true;
  refresh3dMeasurements();
}

function fit3dPreview() {
  frame3dPreview(new THREE.Vector3(1, 1, 1));
}

// Camera directions are expressed in Three.js scene space. The preview group
// rotates OpenSCAD's Z-up coordinates into Three.js's Y-up coordinates.
const PLANE_VIEWS = {
  '+X': { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  '-X': { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  '+Y': { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  '-Y': { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  '+Z': { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  '-Z': { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1) }
};

function setPlaneView(plane) {
  const view = PLANE_VIEWS[plane];
  if (view) frame3dPreview(view.direction, view.up);
}

function setOrthographicProjection(enabled) {
  const previousCamera = camera;
  const direction = previousCamera.position.clone().sub(controls.target).normalize();
  const previousHeight = previousCamera.isOrthographicCamera
    ? (previousCamera.top - previousCamera.bottom) / previousCamera.zoom
    : 2 * previousCamera.position.distanceTo(controls.target) * Math.tan(
      THREE.MathUtils.degToRad(previousCamera.fov) / 2
    );

  camera = enabled ? orthographicCamera : perspectiveCamera;
  camera.up.copy(previousCamera.up);
  camera.near = previousCamera.near;
  camera.far = previousCamera.far;
  if (camera.isOrthographicCamera) {
    camera.position.copy(previousCamera.position);
    camera.zoom = (camera.top - camera.bottom) / previousHeight;
  } else {
    const distance = previousHeight /
      (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    camera.position.copy(controls.target).addScaledVector(direction, distance);
  }
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  controls.object = camera;
  controls.update();
  projection3dButton.setAttribute('aria-pressed', String(enabled));
  projection3dButton.textContent = enabled ? 'Perspective' : 'Isometric';
  projection3dButton.title = enabled
    ? 'Switch to perspective projection'
    : 'Switch to isometric projection';
  refresh3dMeasurements();
}

function toggle3dProjection() {
  const enableIsometric = !camera.isOrthographicCamera;
  setOrthographicProjection(enableIsometric);
}

fit3dButton.addEventListener('click', fit3dPreview);
canvas.addEventListener('dblclick', fit3dPreview);
for (const button of planeViewButtons) {
  button.addEventListener('click', () => setPlaneView(button.dataset.planeView));
}
projection3dButton.addEventListener('click', toggle3dProjection);
axes3dButton.addEventListener('click', () => {
  axes3dVisible = !axes3dVisible;
  measurementGroup.visible = axes3dVisible;
  axes3dButton.setAttribute('aria-pressed', String(axes3dVisible));
  axes3dButton.textContent = axes3dVisible ? 'Hide axes' : 'Show axes';
  if (axes3dVisible) refresh3dMeasurements();
});

function showHybrid(parts) {
  emptyPreview.hidden = true;
  canvas.hidden = false;
  fit3dButton.hidden = false;
  axes3dButton.hidden = false;
  viewPresets3d.hidden = false;
  projection3dButton.hidden = false;
  clear3dPreview();

  let triangles = 0;
  let twoDimensionalParts = 0;
  let threeDimensionalParts = 0;
  for (const part of parts) {
    const geom = parseStl(part.data);
    const partMaterial = materialForPart(part);
    modelGroup.add(new THREE.Mesh(geom, partMaterial));
    triangles += geom.attributes.position.count / 3;
    if (part.dimension === 2) twoDimensionalParts++;
    else threeDimensionalParts++;
  }
  updateMeasurementBounds();
  if (!has3dViewpoint) fit3dPreview();
  else refresh3dMeasurements();
  return { triangles, twoDimensionalParts, threeDimensionalParts };
}

async function renderToScene(code) {
  const myId = ++pending;
  const t0 = performance.now();
  setStatus('Rendering\u2026');
  setCompileLog('Compiling\u2026');
  const result = await runPreview(code);
  if (myId !== pending) return; // superseded
  const ms = (performance.now() - t0).toFixed(0);
  if (!result.success) {
    if (result.mixedDimensions) {
      showPlaceholder('This branch mixes incompatible 2D and 3D operations');
    }
    setCompileLog(result.log || result.stderr);
    setStatus(
      `Error (${ms} ms)\n${result.stderr || 'OpenSCAD produced no diagnostic output.'}`,
      true
    );
    vscode.postMessage({ type: 'rendered', success: false, stderr: result.stderr });
    return;
  }
  try {
    setCompileLog(result.log);
    if (result.empty) {
      showEmpty();
      setStatus(`Empty \u00b7 ${ms} ms \u00b7 no top-level geometry`);
    } else if (result.format === PREVIEW_COLOR_FORMAT) {
      const summary = showWrl(result.parsed);
      setStatus(`OK \u00b7 ${ms} ms \u00b7 3D color scene \u00b7 ` +
        `${summary.materialCount} materials \u00b7 ${summary.triangleCount.toLocaleString()} triangles`);
    } else if (result.format === PREVIEW_HYBRID_FORMAT) {
      const summary = showHybrid(result.parts);
      setStatus(
        `OK \u00b7 ${ms} ms \u00b7 Hybrid 2D + 3D \u00b7 ` +
        `${summary.twoDimensionalParts} flat + ${summary.threeDimensionalParts} solid \u00b7 ` +
        `${summary.triangles.toLocaleString()} triangles`
      );
    } else if (result.format === PREVIEW_SCENE_FORMAT) {
      const summary = showHybrid(result.parts);
      const sceneLabel = summary.twoDimensionalParts > 0
        ? `2D geometry in 3D view \u00b7 ${summary.twoDimensionalParts} flat parts`
        : `3D color scene \u00b7 ${summary.threeDimensionalParts} parts`;
      setStatus(`OK \u00b7 ${ms} ms \u00b7 ${sceneLabel} \u00b7 ` +
        `${summary.triangles.toLocaleString()} triangles`);
    } else {
      const tris = show3d(result.data);
      setStatus(`OK \u00b7 ${ms} ms \u00b7 3D \u00b7 ${tris.toLocaleString()} triangles \u00b7 ${result.data.byteLength.toLocaleString()} B`);
    }
    vscode.postMessage({ type: 'rendered', success: true, stderr: result.stderr });
  } catch (e) {
    setCompileLog(String(e));
    setStatus('Preview failed: ' + e.message, true);
    vscode.postMessage({ type: 'rendered', success: false, stderr: String(e) });
  }
}

function beginHostRender(generation) {
  hostRenderGeneration = generation;
  pending++; // Supersede any WASM render whose result has not been displayed.
  setStatus('Rendering with native OpenSCAD…');
  setCompileLog('Compiling with native OpenSCAD…');
}

function showNativeRender(msg) {
  if (msg.generation !== hostRenderGeneration) return;
  try {
    const source = new TextDecoder().decode(decodeBase64(msg.data));
    const summary = showWrl(parseOpenScadWrl(source));
    setCompileLog(msg.stderr);
    const renderLabel = msg.cached ? 'Native cache' : 'Native OpenSCAD';
    setStatus(`OK · ${msg.milliseconds} ms · ${renderLabel} · ` +
      `${summary.materialCount} materials · ` +
      `${summary.triangleCount.toLocaleString()} triangles`);
    vscode.postMessage({ type: 'rendered', success: true, stderr: msg.stderr });
  } catch (error) {
    setCompileLog(String(error));
    setStatus('Native preview failed: ' + error.message, true);
    vscode.postMessage({ type: 'rendered', success: false, stderr: String(error) });
  }
}

async function doExport(code, format) {
  setStatus('Exporting (' + format + ')\u2026');
  setCompileLog('Compiling export\u2026');
  const result = await runOpenscad(code, format);
  setCompileLog(result.log || result.stderr);
  if (!result.success) {
    vscode.postMessage({ type: 'exportResult', success: false, error: result.stderr });
    setStatus('Export failed', true);
    return;
  }
  // base64-encode binary for postMessage
  let bin = '';
  const bytes = result.data;
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  vscode.postMessage({ type: 'exportResult', success: true, data: b64 });
  setStatus('Export ready (' + result.data.length + ' B)');
}

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  registerFonts(msg?.fonts);
  registerDocumentFiles(msg?.files);
  if (msg?.type === 'renderStart') beginHostRender(msg.generation);
  else if (msg?.type === 'nativeRender') showNativeRender(msg);
  else if (msg?.type === 'render') renderToScene(msg.code);
  else if (msg?.type === 'export') doExport(msg.code, msg.format || 'binstl');
});

// Tell host we're ready (in case the initial 'ready' was sent before this listener registered).
vscode.postMessage({ type: 'ready' });
