import * as path from 'path';

/** A dependency of the previewed file, keyed in the result by its path in the WASM filesystem. */
export interface Dep { real: string; data: Uint8Array }
export type Reader = (realPath: string) => Promise<Uint8Array | undefined>;

/** Where library-path includes are mounted; the webview sets OPENSCADPATH to this. */
export const LIB_ROOT = '/libraries';

const REF = /\b(?:include|use)\s*<([^>\n]+)>|\bimport\s*\(\s*(?:file\s*=\s*)?"([^"\n]+)"/g;

/** Host path -> absolute POSIX path for the WASM filesystem (C:\a\b -> /C/a/b). */
export const toVirtual = (p: string) =>
  path.posix.resolve('/', p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1'));

/**
 * Walk include/use/import references from the entry file, resolving each the way
 * OpenSCAD does: relative to the referencing file first, then each library dir.
 * Files are mounted the way they were reached, so OpenSCAD finds them again.
 */
export async function collectDeps(
  entryReal: string, entryText: string, libDirs: string[], read: Reader
): Promise<Map<string, Dep>> {
  const out = new Map<string, Dep>();
  const queue = [{ real: entryReal, virt: toVirtual(entryReal), text: entryText }];
  for (let cur = queue.pop(); cur; cur = queue.pop()) {
    for (const m of cur.text.matchAll(REF)) {
      const name = (m[1] ?? m[2]).trim();
      const candidates = [
        { real: path.resolve(path.dirname(cur.real), name),
          virt: path.posix.resolve(path.posix.dirname(cur.virt), name) },
        ...libDirs.map((d) => ({ real: path.resolve(d, name), virt: path.posix.resolve(LIB_ROOT, name) }))
      ];
      for (const c of candidates) {
        if (out.has(c.virt)) break;
        const data = await read(c.real);
        if (!data) continue;
        out.set(c.virt, { real: c.real, data });
        if (/\.scad$/i.test(c.real)) queue.push({ ...c, text: new TextDecoder().decode(data) });
        break;
      }
    }
  }
  return out;
}
