import * as vscode from 'vscode';
import * as path from 'path';
import { fontsForDocument } from './fonts';
// This module stays plain ESM so its process orchestration can be unit-tested
// without loading the VS Code runtime.
// @ts-ignore
import { findNativeOpenScad, renderNativeWrl } from './native-openscad.mjs';
// @ts-ignore
import { NativeRenderCache, nativeRenderCacheKey } from './render-cache.mjs';

const VIEW_TYPE = 'carve.preview';
const DIAG = vscode.languages.createDiagnosticCollection('carve');

let currentPanel: vscode.WebviewPanel | undefined;
let renderTimer: NodeJS.Timeout | undefined;
let renderedDocument: vscode.TextDocument | undefined;
let renderGeneration = 0;
let sentFonts = new Set<string>();
let nativeRenderAbort: AbortController | undefined;
let nativeExecutableKey = '';
let nativeExecutablePromise: Promise<string | undefined> | undefined;
const nativePreviewCache = new NativeRenderCache();

interface WebviewFile {
  name: string;
  data: string;
}

function referencedFiles(code: string): string[] {
  const files = new Set<string>();
  const call = /\b(?:import|surface)\s*\(([^;]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(code))) {
    const args = match[1];
    const named = args.match(/\bfile\s*=\s*"((?:\\.|[^"\\])*)"/);
    const positional = args.match(/^\s*"((?:\\.|[^"\\])*)"/);
    const value = (named ?? positional)?.[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    if (value) files.add(value);
  }
  const directive = /\b(?:include|use)\s*<([^>]+)>/g;
  while ((match = directive.exec(code))) {
    const value = match[1].trim();
    if (value) files.add(value);
  }
  return [...files];
}

function hasCompleteDependencySnapshot(code: string, files: WebviewFile[]): boolean {
  const available = new Set(files.map((file) => file.name));
  return referencedFiles(code).every((name) => {
    if (path.isAbsolute(name) || /^[a-z][a-z0-9+.-]*:/i.test(name)) return false;
    return available.has(name.replace(/\\/g, '/'));
  });
}

async function filesForDocument(doc: vscode.TextDocument, code: string): Promise<WebviewFile[]> {
  if (doc.uri.scheme === 'untitled') return [];
  const files = await Promise.all(referencedFiles(code).map(async (name) => {
    // Host absolute paths cannot be reproduced portably inside the WASM filesystem.
    if (path.isAbsolute(name) || /^[a-z][a-z0-9+.-]*:/i.test(name)) return undefined;
    const segments = name.replace(/\\/g, '/').split('/');
    const uri = vscode.Uri.joinPath(doc.uri, '..', ...segments);
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      return { name: name.replace(/\\/g, '/'), data: Buffer.from(data).toString('base64') };
    } catch {
      // Let OpenSCAD report the missing file with the source location.
      return undefined;
    }
  }));
  return files.filter((file): file is WebviewFile => !!file);
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('carve.openPreview', () => openPreview(ctx)),
    vscode.commands.registerCommand('carve.refresh', () => triggerRender(true)),
    vscode.commands.registerCommand('carve.exportStl', () => exportStl()),
    vscode.workspace.onDidChangeTextDocument((e) => onDocChange(e)),
    vscode.window.onDidChangeActiveTextEditor((e) => onActiveEditorChange(e)),
    DIAG
  );
}

export function deactivate() {
  if (renderTimer) clearTimeout(renderTimer);
  nativeRenderAbort?.abort();
  DIAG.dispose();
}

function openPreview(ctx: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'scad') {
    vscode.window.showInformationMessage('Open a .scad file to preview.');
    return;
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    triggerRender(true);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    `Carve: ${path.basename(editor.document.fileName)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(ctx.extensionUri, 'media'),
        vscode.Uri.joinPath(ctx.extensionUri, 'dist')
      ]
    }
  );
  currentPanel = panel;
  vscode.commands.executeCommand('setContext', 'carve.previewActive', true);

  panel.webview.html = renderWebviewHtml(panel.webview, ctx.extensionUri);

  panel.webview.onDidReceiveMessage((msg) => onWebviewMessage(msg));
  panel.onDidDispose(() => {
    currentPanel = undefined;
    renderedDocument = undefined;
    sentFonts = new Set<string>();
    vscode.commands.executeCommand('setContext', 'carve.previewActive', false);
    DIAG.clear();
  });

  // First render once webview is ready (initiated by webview 'ready' message)
}

function onWebviewMessage(msg: any) {
  switch (msg?.type) {
    case 'ready':
      triggerRender(true);
      break;
    case 'rendered':
      publishDiagnostics(msg.stderr ?? '');
      break;
    case 'log':
      console.log('[carve webview]', msg.text);
      break;
  }
}

function onDocChange(e: vscode.TextDocumentChangeEvent) {
  if (!currentPanel || e.document.languageId !== 'scad') return;
  const cfg = vscode.workspace.getConfiguration('carve');
  if (!cfg.get<boolean>('autoRender', true)) return;
  const debounce = cfg.get<number>('debounceMs', 500);
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderDocument(e.document, false), debounce);
}

function onActiveEditorChange(editor: vscode.TextEditor | undefined) {
  if (!currentPanel || !editor || editor.document.languageId !== 'scad') return;
  currentPanel.title = `Carve: ${path.basename(editor.document.fileName)}`;
  renderDocument(editor.document, true);
}

function triggerRender(force: boolean) {
  if (!currentPanel) return;
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document.languageId === 'scad'
    ? editor.document
    : vscode.workspace.textDocuments.find((d) => d.languageId === 'scad');
  if (!doc) return;
  renderDocument(doc, force);
}

async function renderDocument(doc: vscode.TextDocument, force: boolean) {
  if (!currentPanel) return;
  const generation = ++renderGeneration;
  const code = doc.getText();
  nativeRenderAbort?.abort();
  nativeRenderAbort = undefined;
  if (renderedDocument && renderedDocument.uri.toString() !== doc.uri.toString()) {
    DIAG.delete(renderedDocument.uri);
  }
  renderedDocument = doc;
  const cfg = vscode.workspace.getConfiguration('carve', doc.uri);
  const filesPromise = filesForDocument(doc, code);
  currentPanel.webview.postMessage({ type: 'renderStart', generation });

  const backend = cfg.get<string>('renderBackend', 'auto');
  if (backend !== 'wasm') {
    const configuredPath = cfg.get<string>('nativeOpenSCADPath', '').trim();
    const executableKey = `${process.platform}\0${configuredPath}`;
    if (!nativeExecutablePromise || nativeExecutableKey !== executableKey) {
      nativeExecutableKey = executableKey;
      nativeExecutablePromise = findNativeOpenScad({ configuredPath });
    }
    const executable = await nativeExecutablePromise;
    if (!currentPanel || generation !== renderGeneration) return;
    if (executable) {
      const dependencyFiles = await filesPromise;
      if (!currentPanel || generation !== renderGeneration) return;
      const cacheKey = hasCompleteDependencySnapshot(code, dependencyFiles)
        ? nativeRenderCacheKey({
            documentUri: doc.uri.toString(),
            code,
            executable,
            files: dependencyFiles
          })
        : undefined;
      const cachedResult = cacheKey ? nativePreviewCache.get(cacheKey) : undefined;
      if (cachedResult) {
        currentPanel.webview.postMessage({
          type: 'nativeRender',
          generation,
          data: cachedResult.data.toString('base64'),
          stderr: cachedResult.stderr,
          milliseconds: 0,
          executable,
          cached: true
        });
        return;
      }
      const abort = new AbortController();
      nativeRenderAbort = abort;
      const nativeResult = await renderNativeWrl({
        executable,
        code,
        cwd: doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : undefined,
        signal: abort.signal
      });
      if (!currentPanel || generation !== renderGeneration || abort.signal.aborted) return;
      nativeRenderAbort = undefined;
      if (nativeResult.success) {
        if (cacheKey) nativePreviewCache.set(cacheKey, nativeResult);
        currentPanel.webview.postMessage({
          type: 'nativeRender',
          generation,
          data: nativeResult.data.toString('base64'),
          stderr: nativeResult.stderr,
          milliseconds: nativeResult.milliseconds,
          executable
        });
        return;
      }
    }
  }

  const configuredFonts = cfg.get<string[]>('fontFiles', []);
  const [availableFonts, files] = await Promise.all([
    fontsForDocument(code, configuredFonts),
    filesPromise
  ]);
  if (!currentPanel || generation !== renderGeneration) return;
  const fonts = availableFonts.filter((font) => {
    if (sentFonts.has(font.name)) return false;
    sentFonts.add(font.name);
    return true;
  });
  currentPanel.webview.postMessage({
    type: 'render',
    code,
    fileName: path.basename(doc.fileName),
    format: 'binstl',
    fonts,
    files,
    force
  });
}

async function exportStl() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'scad') {
    vscode.window.showInformationMessage('Open a .scad file to export.');
    return;
  }
  if (!currentPanel) {
    vscode.window.showWarningMessage('Open the Carve preview first (Carve: Open Live Preview).');
    return;
  }
  const panel = currentPanel;
  const cfg = vscode.workspace.getConfiguration('carve');
  const fmt = cfg.get<string>('exportFormat', 'binstl');
  const ext = fmt.startsWith('stl') || fmt.endsWith('stl') ? 'stl' : fmt;
  const defaultUri = vscode.Uri.file(
    editor.document.uri.fsPath.replace(/\.scad$/i, `.${ext}`)
  );
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { '3D Model': [ext] }
  });
  if (!target) return;

  // Listen for one-shot export reply
  const disposable = panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type !== 'exportResult') return;
    disposable.dispose();
    if (!msg.success) {
      vscode.window.showErrorMessage(`Carve export failed: ${msg.error ?? 'unknown error'}`);
      return;
    }
    const buf = Buffer.from(msg.data, 'base64');
    await vscode.workspace.fs.writeFile(target, buf);
    vscode.window.showInformationMessage(`Exported ${buf.byteLength} bytes to ${target.fsPath}`);
  });

  panel.webview.postMessage({
    type: 'export',
    code: editor.document.getText(),
    fileName: path.basename(editor.document.fileName),
    format: fmt,
    files: await filesForDocument(editor.document, editor.document.getText()),
    fonts: (await fontsForDocument(
      editor.document.getText(),
      cfg.get<string[]>('fontFiles', [])
    )).filter((font) => {
      if (sentFonts.has(font.name)) return false;
      sentFonts.add(font.name);
      return true;
    })
  });
}

function publishDiagnostics(stderr: string) {
  const doc = renderedDocument;
  if (!doc || doc.languageId !== 'scad') return;
  const diags: vscode.Diagnostic[] = [];
  // OpenSCAD error format examples:
  //   ERROR: Parser error in file "/in.scad", line 3: syntax error
  //   WARNING: ... in file /in.scad, line 5
  const re = /^(ERROR|WARNING):\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const sev = m[1].toUpperCase() === 'ERROR'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
    const location = m[2].match(/\s+in file\s+[^,\n]+,?\s+line\s+(\d+)/i);
    const line = Math.max(0, parseInt(location?.[1] ?? '1', 10) - 1);
    const range = doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
    const message = m[2].replace(/\s+in file\s+[^,\n]+,?\s+line\s+\d+/i, '').trim();
    diags.push(new vscode.Diagnostic(range, message || m[0], sev));
  }
  DIAG.set(doc.uri, diags);
}

function renderWebviewHtml(webview: vscode.Webview, extUri: vscode.Uri): string {
  const mediaUri = vscode.Uri.joinPath(extUri, 'media');
  const wasmJs   = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'openscad.js'));
  const wasmBin  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'openscad.wasm'));
  const viewerJs = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'viewer.js'));
  const threeJs  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'three.module.js'));
  const orbitJs  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'OrbitControls.js'));
  const stlJs    = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'STLLoader.js'));
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval' 'unsafe-eval'`,
    `connect-src ${webview.cspSource} blob:`,
    `worker-src ${webview.cspSource} blob:`,
    `font-src ${webview.cspSource}`
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Carve Preview</title>
<style>
  html, body { margin: 0; height: 100%; background: #2a2a3a; color: #ddd; font-family: var(--vscode-font-family); }
  #status { position: absolute; z-index: 4; top: 8px; left: 8px; right: 8px; padding: 4px 10px;
            font: 12px var(--vscode-editor-font-family); background: rgba(0,0,0,0.45);
            border-radius: 4px; pointer-events: none;
            max-height: 50vh; overflow-y: auto; white-space: pre-wrap;
            word-break: break-word; }
  #viewer { width: 100vw; height: 100vh; display: block; }
  #emptyPreview { width: 100vw; height: 100vh; display: grid; place-items: center;
                  color: var(--vscode-descriptionForeground, #aaa); font-size: 13px; }
  .viewer-button { position: absolute; z-index: 3; bottom: 10px;
           border: 1px solid var(--vscode-button-border, #999);
           border-radius: 4px; padding: 4px 9px;
           color: var(--vscode-button-foreground, #fff);
           background: var(--vscode-button-background, #555); cursor: pointer; }
  .viewer-button:hover { background: var(--vscode-button-hoverBackground, #666); }
  .fit-button { right: 10px; }
  #axes3d { right: 58px; }
  #viewPresets3d { position: absolute; z-index: 3; right: 143px; bottom: 10px;
                   display: grid; grid-template-columns: repeat(3, auto); gap: 3px; }
  #viewPresets3d .viewer-button { position: static; min-width: 30px; padding-inline: 7px; }
  #projection3d { right: 247px; }
  [hidden] { display: none !important; }
  #status.error { background: rgba(150,30,30,0.75); }
  #consoleToggle { left: 10px; }
  #consoleToggle.has-problems { background: var(--vscode-inputValidation-warningBackground, #7a5d00); }
  #compileConsole { position: absolute; z-index: 6; left: 8px; right: 8px; bottom: 44px;
                    max-height: 42vh; overflow: auto; border: 1px solid var(--vscode-panel-border, #666);
                    border-radius: 4px; background: var(--vscode-panel-background, #1e1e1e);
                    box-shadow: 0 3px 12px rgba(0,0,0,0.45); }
  #compileLog { margin: 0; padding: 10px 12px; color: var(--vscode-terminal-foreground, #ddd);
                font: 12px/1.45 var(--vscode-editor-font-family); white-space: pre-wrap;
                word-break: break-word; user-select: text; }
</style>
</head>
<body>
<canvas id="viewer"></canvas>
<button id="consoleToggle" class="viewer-button" type="button" aria-expanded="false"
        title="Show or hide OpenSCAD compiler output">Compilation log</button>
<button id="axes3d" class="viewer-button" type="button" aria-pressed="true" hidden>Hide axes</button>
<div id="viewPresets3d" role="group" aria-label="3D plane views" hidden>
  <button class="viewer-button" type="button" data-plane-view="+X"
          title="View from +X toward the YZ plane">+X</button>
  <button class="viewer-button" type="button" data-plane-view="+Y"
          title="View from +Y toward the XZ plane">+Y</button>
  <button class="viewer-button" type="button" data-plane-view="+Z"
          title="View from the top (+Z) toward the XY plane">+Z</button>
  <button class="viewer-button" type="button" data-plane-view="-X"
          title="View from -X toward the YZ plane">-X</button>
  <button class="viewer-button" type="button" data-plane-view="-Y"
          title="View from -Y toward the XZ plane">-Y</button>
  <button class="viewer-button" type="button" data-plane-view="-Z"
          title="View from the bottom (-Z) toward the XY plane">-Z</button>
</div>
<button id="projection3d" class="viewer-button" type="button" aria-pressed="false" hidden
        title="Switch to isometric projection">Isometric</button>
<button id="fit3d" class="viewer-button fit-button" type="button" hidden
        title="Zoom to fit (double-click the canvas)">Fit</button>
<div id="emptyPreview" hidden>No top-level geometry to preview</div>
<div id="status">Loading OpenSCAD WebAssembly\u2026</div>
<section id="compileConsole" aria-label="OpenSCAD compilation log" hidden>
  <pre id="compileLog">No compiler output yet.</pre>
</section>
<script nonce="${nonce}">
  const bootstrapStatus = document.getElementById('status');
  window.addEventListener('error', (event) => {
    if (!bootstrapStatus.textContent.startsWith('Loading')) return;
    const source = event.target?.src ? '\n' + event.target.src : '';
    bootstrapStatus.textContent = 'Failed to start Carve: ' +
      (event.message || 'module load error') + source;
    bootstrapStatus.classList.add('error');
  }, true);
  window.setTimeout(() => {
    if (!bootstrapStatus.textContent.startsWith('Loading')) return;
    bootstrapStatus.textContent = 'Carve startup timed out while loading its preview module.';
    bootstrapStatus.classList.add('error');
  }, 10000);
</script>
<script type="importmap" nonce="${nonce}">
{
  "imports": {
    "openscad": "${wasmJs}",
    "openscad-wasm": "${wasmBin}",
    "three": "${threeJs}",
    "three/addons/controls/OrbitControls.js": "${orbitJs}",
    "three/addons/loaders/STLLoader.js": "${stlJs}"
  }
}
</script>
<script type="module" nonce="${nonce}" src="${viewerJs}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
