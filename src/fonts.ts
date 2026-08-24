import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface WebviewFont {
  name: string;
  data: string;
}

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const FONT_STYLE_SUFFIX = /(?:regular|bold|italic|oblique|medium|light|thin|black|heavy|condensed|narrow|semibold|demibold)+$/;
const fontDataCache = new Map<string, Promise<WebviewFont | undefined>>();
let fontCatalogPromise: Promise<string[]> | undefined;

function defaultFontDirectories(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Fonts'),
      '/Library/Fonts',
      '/System/Library/Fonts'
    ];
  }
  if (process.platform === 'win32') {
    return [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')];
  }
  return [
    path.join(home, '.fonts'),
    path.join(home, '.local', 'share', 'fonts'),
    '/usr/local/share/fonts',
    '/usr/share/fonts'
  ];
}

async function collectFontFiles(directory: string, files: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFontFiles(entryPath, files);
    } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }));
}

async function fontCatalog(): Promise<string[]> {
  if (!fontCatalogPromise) {
    fontCatalogPromise = (async () => {
      const files: string[] = [];
      for (const directory of defaultFontDirectories()) {
        await collectFontFiles(directory, files);
      }
      return files;
    })();
  }
  return fontCatalogPromise;
}

function normalizedFontName(value: string): string {
  return value.normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function requestedFontFamilies(code: string): string[] {
  const families = new Set<string>();
  const assignment = /\bfont\s*=\s*"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(code))) {
    const family = match[1].replace(/\\"/g, '"').split(':', 1)[0].trim();
    if (family) families.add(family);
  }
  return [...families];
}

function matchingFontPaths(catalog: string[], family: string): string[] {
  const wanted = normalizedFontName(family);
  if (!wanted) return [];
  return catalog.map((fontPath) => {
    const stem = normalizedFontName(path.basename(fontPath, path.extname(fontPath)));
    const score = stem === wanted
      ? 0
      : stem.replace(FONT_STYLE_SUFFIX, '') === wanted
        ? 1
        : stem.startsWith(wanted)
          ? 2
          : -1;
    return { fontPath, score };
  })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.fontPath.localeCompare(b.fontPath))
    .slice(0, 12)
    .map(({ fontPath }) => fontPath);
}

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith(`~${path.sep}`)) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

async function loadFont(fontPath: string): Promise<WebviewFont | undefined> {
  const resolved = path.resolve(expandHome(fontPath));
  let cached = fontDataCache.get(resolved);
  if (!cached) {
    cached = fs.readFile(resolved)
      .then((data) => ({ name: path.basename(resolved), data: data.toString('base64') }))
      .catch(() => undefined);
    fontDataCache.set(resolved, cached);
  }
  return cached;
}

export async function fontsForDocument(code: string, configuredFiles: string[]): Promise<WebviewFont[]> {
  const paths = new Set(configuredFiles.map(expandHome));
  if (/\btext\s*\(/.test(code)) {
    const catalog = await fontCatalog();
    const families = requestedFontFamilies(code);
    for (const family of families) {
      for (const fontPath of matchingFontPaths(catalog, family)) paths.add(fontPath);
    }

    // OpenSCAD needs a usable default for text() calls without a font argument.
    if (families.length === 0) {
      for (const fallback of ['Arial', 'Helvetica', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans']) {
        const matches = matchingFontPaths(catalog, fallback);
        if (matches.length) {
          paths.add(matches[0]);
          break;
        }
      }
    }
  }

  const loaded = await Promise.all([...paths].map(loadFont));
  return loaded.filter((font): font is WebviewFont => !!font);
}
