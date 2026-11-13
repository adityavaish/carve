// @ts-nocheck
// Carve webview viewer: drives the OpenSCAD WASM module + Three.js mesh viewer.
// Loaded from media/viewer.js inside a VS Code Webview.

import OpenSCAD from 'openscad';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { moduleOptions, runJob } from './run.js';

const vscode = acquireVsCodeApi();
const $status = document.getElementById('status');
const canvas = document.getElementById('viewer');

const setStatus = (text, isError = false) => {
  $status.textContent = text;
  $status.classList.toggle('error', !!isError);
};

// Emscripten reads print/printErr once at start-up, so they have to be passed
// in as module options; assigning them afterwards captures nothing.
function captureOutput() {
  const out = [];
  const err = [];
  return {
    options: { print: (s) => out.push(s), printErr: (s) => err.push(s) },
    stdout: () => out.join('\n'),
    stderr: () => err.join('\n'),
    reset: () => { out.length = 0; err.length = 0; }
  };
}

setStatus('Loading openscad.wasm\u2026');
let wasmBinary;
let capture;
let Module; // current instance, replaced per render
try {
  const wasmUrl = new URL(import.meta.resolve('openscad-wasm'));
  wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  // Eager-instantiate once so the first render is fast.
  Module = await freshModule();
  setStatus('Ready.');
  vscode.postMessage({ type: 'ready' });
} catch (e) {
  setStatus('Failed to load OpenSCAD WASM: ' + e.message, true);
  vscode.postMessage({ type: 'rendered', success: false, stderr: String(e) });
  throw e;
}

async function freshModule() {
  const wasmUrl = new URL(import.meta.resolve('openscad-wasm'));
  capture = captureOutput();
  return OpenSCAD({
    ...moduleOptions,
    ...capture.options,
    wasmBinary,
    locateFile: () => wasmUrl.toString()
  });
}

// --- Three.js scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a3a);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
camera.position.set(80, 80, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(1, 1, 1);
scene.add(dir);
scene.add(new THREE.GridHelper(100, 10, 0x444466, 0x333344));

let mesh = null;
const material = new THREE.MeshStandardMaterial({
  color: 0xf9b233, metalness: 0.1, roughness: 0.6, flatShading: true
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
function loop() {
  requestAnimationFrame(loop);
  resize();
  controls.update();
  renderer.render(scene, camera);
}
loop();

// --- Render pipeline ------------------------------------------------------
let pending = 0;
let moduleUsed = false; // true once we've called callMain on `Module`
async function runOpenscad(job, format) {
  // OpenSCAD's main() leaves C++ static state behind that prevents a clean
  // second call. Re-instantiate the module between renders.
  if (moduleUsed) {
    Module = await freshModule();
  }
  moduleUsed = true;
  capture.reset();
  let res;
  try {
    res = runJob(Module, job, format);
  } catch (e) {
    return { success: false, stderr: capture.stderr() || String(e) };
  }
  if (res.rc !== 0 && res.rc !== undefined) {
    return { success: false, stderr: capture.stderr() || `OpenSCAD exited ${res.rc}` };
  }
  if (!res.data) {
    return { success: false, stderr: capture.stderr() || 'No output produced' };
  }
  return { success: true, data: res.data, stderr: capture.stderr() };
}

async function renderToScene(job) {
  const myId = ++pending;
  const t0 = performance.now();
  setStatus('Rendering\u2026');
  const result = await runOpenscad(job, 'binstl');
  if (myId !== pending) return; // superseded
  const ms = (performance.now() - t0).toFixed(0);
  if (!result.success) {
    setStatus(`Error (${ms} ms)`, true);
    vscode.postMessage({ type: 'rendered', success: false, stderr: result.stderr });
    return;
  }
  const stl = result.data;
  try {
    const geom = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength));
    geom.computeVertexNormals();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = new THREE.Mesh(geom, material);
    mesh.rotation.x = -Math.PI / 2; // OpenSCAD Z-up -> Three.js Y-up
    scene.add(mesh);
    geom.computeBoundingSphere();
    const r = Math.max(20, geom.boundingSphere.radius);
    if (mesh.__isFirst !== false) {
      camera.position.set(r * 2, r * 2, r * 2);
      controls.target.set(0, 0, 0);
      mesh.__isFirst = false;
    }
    const tris = geom.attributes.position.count / 3;
    setStatus(`OK \u00b7 ${ms} ms \u00b7 ${tris.toLocaleString()} triangles \u00b7 ${stl.byteLength.toLocaleString()} B`);
    vscode.postMessage({ type: 'rendered', success: true, stderr: result.stderr });
  } catch (e) {
    setStatus('STL parse failed: ' + e.message, true);
    vscode.postMessage({ type: 'rendered', success: false, stderr: String(e) });
  }
}

async function doExport(job, format) {
  setStatus('Exporting (' + format + ')\u2026');
  const result = await runOpenscad(job, format);
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
  if (msg?.type === 'render') renderToScene(msg.job);
  else if (msg?.type === 'export') doExport(msg.job, msg.format || 'binstl');
});

// Tell host we're ready (in case the initial 'ready' was sent before this listener registered).
vscode.postMessage({ type: 'ready' });
