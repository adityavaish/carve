import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { collectDeps, toVirtual } from './deps';

const VIEW_TYPE = 'carve.preview';
const DIAG = vscode.languages.createDiagnosticCollection('carve');

let currentPanel: vscode.WebviewPanel | undefined;
let renderTimer: NodeJS.Timeout | undefined;
/** WASM filesystem path -> host path, for the last job sent to the webview. */
let lastPaths = new Map<string, string>();

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

/** Directories searched for `include <lib/file.scad>`, in OpenSCAD's order. */
function libraryDirs(doc: vscode.TextDocument): string[] {
  const base = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? path.dirname(doc.fileName);
  const configured = vscode.workspace.getConfiguration('carve').get<string[]>('libraryPaths', []);
  const userDir = process.platform === 'linux' ? '.local/share/OpenSCAD/libraries' : 'Documents/OpenSCAD/libraries';
  return [
    ...configured.map((p) => path.resolve(base, p)),
    ...(process.env.OPENSCADPATH ?? '').split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), userDir)
  ];
}

/** Read a dependency, preferring unsaved editor contents over the file on disk. */
async function readDep(realPath: string): Promise<Uint8Array | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.isDirty && d.uri.fsPath === realPath);
  if (open) return new TextEncoder().encode(open.getText());
  try { return new Uint8Array(await fs.readFile(realPath)); } catch { return undefined; }
}

/**
 * The document plus everything it includes, ready to mount in the WASM filesystem.
 * Every dependency is re-read and re-sent per render (BOSL2 is about 5 MB); cache
 * by mtime on both sides if large libraries make live preview lag.
 */
async function buildJob(doc: vscode.TextDocument) {
  const deps = await collectDeps(doc.fileName, doc.getText(), libraryDirs(doc), readDep);
  const entry = toVirtual(doc.fileName);
  lastPaths = new Map([[entry, doc.fileName], ...[...deps].map(([v, d]) => [v, d.real] as [string, string])]);
  return { entry, code: doc.getText(), files: [...deps].map(([v, d]) => [v, d.data]) };
}

async function renderDocument(doc: vscode.TextDocument, force: boolean) {
  if (!currentPanel) return;
  const job = await buildJob(doc);
  currentPanel?.webview.postMessage({ type: 'render', job, format: 'binstl', force });
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
  const disposable = currentPanel.webview.onDidReceiveMessage(async (msg) => {
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

  currentPanel.webview.postMessage({ type: 'export', job: await buildJob(editor.document), format: fmt });
}

function publishDiagnostics(stderr: string) {
  DIAG.clear();
  const [entryVirt, entryReal] = [...lastPaths][0] ?? [];
  if (!entryReal) return;
  const byFile = new Map<string, vscode.Diagnostic[]>();
  // OpenSCAD message formats:
  //   ERROR: Parser error: syntax error in file /a/b.scad, line 3
  //   WARNING: Can't find include file 'x.scad'. in file ../lib/y.scad, line 5
  //   ERROR: Something without a location
  const re = /^(ERROR|WARNING):\s*(.*?)(?:\s+in file (.+?),\s*line\s+(\d+))?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const sev = m[1] === 'ERROR' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
    const virt = m[3] ? path.posix.resolve(path.posix.dirname(entryVirt), m[3]) : entryVirt;
    const real = lastPaths.get(virt) ?? entryReal;
    const line = Math.max(0, parseInt(m[4] ?? '1', 10) - 1);
    const diag = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), m[2], sev);
    byFile.set(real, [...(byFile.get(real) ?? []), diag]);
  }
  for (const [file, diags] of byFile) DIAG.set(vscode.Uri.file(file), diags);
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
  #status { position: absolute; top: 8px; left: 8px; right: 8px; padding: 4px 10px;
            font: 12px var(--vscode-editor-font-family); background: rgba(0,0,0,0.45);
            border-radius: 4px; pointer-events: none;
            max-height: 50vh; overflow-y: auto; white-space: pre-wrap;
            word-break: break-word; }
  #viewer { width: 100vw; height: 100vh; display: block; }
  #status.error { background: rgba(150,30,30,0.75); }
</style>
</head>
<body>
<canvas id="viewer"></canvas>
<div id="status">Loading OpenSCAD WebAssembly\u2026</div>
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
