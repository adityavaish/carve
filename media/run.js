// Shared by the webview (viewer.js) and the tests: mount a render job into a
// fresh OpenSCAD WASM module and run it.

/** Options every OpenSCAD module instance needs. Library includes are mounted under /libraries. */
export const moduleOptions = {
  noInitialRun: true,
  noExitRuntime: true,
  preRun: [(m) => { m.ENV.OPENSCADPATH = '/libraries'; }]
};

/** job: { entry, code, files: [[path, Uint8Array]] }. Returns { rc, data } (data undefined if no output). */
export function runJob(Module, job, format) {
  const { FS } = Module;
  for (const [p, data] of [...(job.files ?? []), [job.entry, job.code]]) {
    FS.mkdirTree(p.slice(0, p.lastIndexOf('/')) || '/');
    FS.writeFile(p, data);
  }
  const rc = Module.callMain([job.entry, '-o', '/out', '--export-format=' + format]);
  let data;
  try { data = FS.readFile('/out'); } catch { /* no output */ }
  return { rc, data };
}
