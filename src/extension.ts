import * as vscode from 'vscode';
import * as path from 'path';

const VIEW_TYPE = 'carve.preview';
const DIAG = vscode.languages.createDiagnosticCollection('carve');

let currentPanel: vscode.WebviewPanel | undefined;
let renderTimer: NodeJS.Timeout | undefined;

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
      if (msg.success) {
        DIAG.clear();
      } else {
        publishDiagnostics(msg.stderr ?? '');
      }
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

function renderDocument(doc: vscode.TextDocument, force: boolean) {
  if (!currentPanel) return;
  currentPanel.webview.postMessage({
    type: 'render',
    code: doc.getText(),
    fileName: path.basename(doc.fileName),
    format: 'binstl',
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

  currentPanel.webview.postMessage({
    type: 'export',
    code: editor.document.getText(),
    fileName: path.basename(editor.document.fileName),
    format: fmt
  });
}

function publishDiagnostics(stderr: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'scad') return;
  const diags: vscode.Diagnostic[] = [];
  // OpenSCAD error format examples:
  //   ERROR: Parser error in file "/in.scad", line 3: syntax error
  //   WARNING: ... in file /in.scad, line 5
  const re = /(ERROR|WARNING):\s*([^\n]*?)(?:in file [^,\n]*,?\s*)?line\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const sev = m[1].toUpperCase() === 'ERROR'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
    const line = Math.max(0, parseInt(m[3], 10) - 1);
    const range = editor.document.lineAt(Math.min(line, editor.document.lineCount - 1)).range;
    diags.push(new vscode.Diagnostic(range, m[2].trim() || m[0], sev));
  }
  DIAG.set(editor.document.uri, diags);
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
            border-radius: 4px; pointer-events: none; }
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
