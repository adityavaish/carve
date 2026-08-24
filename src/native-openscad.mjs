import { spawn } from 'node:child_process';

const EXECUTABLE_CANDIDATES = {
  darwin: [
    'openscad',
    '/opt/homebrew/bin/openscad',
    '/usr/local/bin/openscad',
    '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
  ],
  win32: ['openscad.exe'],
  linux: ['openscad', '/usr/bin/openscad', '/usr/local/bin/openscad']
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function nativeOpenScadCandidates(platform = process.platform, configuredPath = '') {
  return unique([
    configuredPath.trim(),
    ...(EXECUTABLE_CANDIDATES[platform] ?? ['openscad'])
  ]);
}

export function probeExecutable(executable, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(executable, ['--version'], { stdio: 'ignore' });
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

export async function findNativeOpenScad({
  platform = process.platform,
  configuredPath = '',
  probe = probeExecutable
} = {}) {
  for (const candidate of nativeOpenScadCandidates(platform, configuredPath)) {
    if (await probe(candidate)) return candidate;
  }
  return undefined;
}

export function renderNativeWrl({ executable, code, cwd, signal }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const stdout = [];
    const stderr = [];
    let settled = false;
    const child = spawn(executable, [
      '--backend=Manifold',
      '-o', '-',
      '--export-format=wrl',
      '-'
    ], {
      cwd,
      signal,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
        milliseconds: Math.round(performance.now() - started)
      });
    };

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => finish({ success: false, error: String(error) }));
    child.once('exit', (exitCode, exitSignal) => {
      const data = Buffer.concat(stdout);
      const diagnostics = Buffer.concat(stderr).toString('utf8');
      const incompatible = /Mixing 2D and 3D objects is not supported|not a 3D object|top level object is empty/i
        .test(diagnostics);
      finish({
        success: exitCode === 0 && data.length > 0 && !incompatible,
        data,
        exitCode,
        signal: exitSignal
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(code);
  });
}
