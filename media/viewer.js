// @ts-nocheck
// Carve webview viewer: drives the OpenSCAD WASM module + Three.js mesh viewer.
// Loaded from media/viewer.js inside a VS Code Webview.

import OpenSCAD from 'openscad';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const vscode = acquireVsCodeApi();
const $status = document.getElementById('status');
const canvas = document.getElementById('viewer');

const setStatus = (text, isError = false) => {
  $status.textContent = text;
  $status.classList.toggle('error', !!isError);
};

function captureOutput(Module) {
  const out = [];
  const err = [];
  Module.print = (s) => out.push(s);
  Module.printErr = (s) => err.push(s);
  return {
    stdout: () => out.join('\n'),
    stderr: () => err.join('\n'),
    reset: () => { out.length = 0; err.length = 0; }
  };
}

setStatus('Loading openscad.wasm\u2026');
let Module, capture;
try {
  // Fetch the .wasm bytes ourselves so Emscripten doesn't try a streaming compile
  // against a vscode-resource:// URL (which it can't match against the script URL).
  const wasmUrl = new URL(import.meta.resolve('openscad-wasm'));
  const wasmBinary = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  Module = await OpenSCAD({
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    locateFile: () => wasmUrl.toString()
  });
  capture = captureOutput(Module);
  setStatus('Ready.');
  vscode.postMessage({ type: 'ready' });
} catch (e) {
  setStatus('Failed to load OpenSCAD WASM: ' + e.message, true);
  vscode.postMessage({ type: 'rendered', success: false, stderr: String(e) });
  throw e;
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
async function runOpenscad(code, format) {
  capture.reset();
  // Reset emscripten exit flags so callMain can be invoked again.
  try { Module.setValue?.(0, 0, 'i32'); } catch {}
  if ('EXITSTATUS' in Module) try { Module.EXITSTATUS = 0; } catch {}
  try { Module.FS.unlink('/in.scad'); } catch {}
  try { Module.FS.unlink('/out'); } catch {}
  Module.FS.writeFile('/in.scad', code);
  let rc;
  try {
    rc = Module.callMain(['/in.scad', '-o', '/out', '--export-format=' + format]);
  } catch (e) {
    return { success: false, stderr: capture.stderr() || String(e) };
  }
  if (rc !== 0 && rc !== undefined) {
    return { success: false, stderr: capture.stderr() || `OpenSCAD exited ${rc}` };
  }
  let data;
  try { data = Module.FS.readFile('/out'); } catch (e) {
    return { success: false, stderr: capture.stderr() || 'No output produced' };
  }
  return { success: true, data, stderr: capture.stderr() };
}

async function renderToScene(code) {
  const myId = ++pending;
  const t0 = performance.now();
  setStatus('Rendering\u2026');
  const result = await runOpenscad(code, 'binstl');
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

async function doExport(code, format) {
  setStatus('Exporting (' + format + ')\u2026');
  const result = await runOpenscad(code, format);
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
  if (msg?.type === 'render') renderToScene(msg.code);
  else if (msg?.type === 'export') doExport(msg.code, msg.format || 'binstl');
});

// Tell host we're ready (in case the initial 'ready' was sent before this listener registered).
vscode.postMessage({ type: 'ready' });
