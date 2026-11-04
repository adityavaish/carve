const FONT_FILES = [
  'LiberationMono-Bold.ttf',
  'LiberationMono-BoldItalic.ttf',
  'LiberationMono-Italic.ttf',
  'LiberationMono-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-BoldItalic.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-Regular.ttf',
  'LiberationSerif-Bold.ttf',
  'LiberationSerif-BoldItalic.ttf',
  'LiberationSerif-Italic.ttf',
  'LiberationSerif-Regular.ttf',
];

const ASSET_FILES = ['fonts.conf', ...FONT_FILES];

async function fetchAsset(fileName) {
  const response = await fetch(new URL(`./fonts/${fileName}`, import.meta.url));
  if (!response.ok) throw new Error(`Failed to load font asset ${fileName}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadFontAssets(loadAsset = fetchAsset) {
  return Promise.all(ASSET_FILES.map(async (fileName) => [fileName, await loadAsset(fileName)]));
}

export function installFonts(Module, assets) {
  try {
    Module.FS.stat('/fonts');
  } catch {
    Module.FS.mkdir('/fonts');
  }

  for (const [fileName, contents] of assets) {
    Module.FS.writeFile(`/fonts/${fileName}`, contents);
  }
}
