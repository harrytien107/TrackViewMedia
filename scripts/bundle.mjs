import { build } from 'esbuild';
import { cp, readFile, writeFile } from 'node:fs/promises';

// MV3 content scripts and service workers cannot load Vite's normal shared chunks.
// Bundle these entries independently so each manifest reference is a single script.
for (const entry of ['content', 'background']) {
  await build({
    entryPoints: [`src/${entry}/index.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome114',
    minify: true,
    sourcemap: false,
  });
}

// Firefox MV2 uses the same content, background, and popup bundles as Chromium.
await cp('dist', 'dist-firefox', { recursive: true, force: true });
const firefoxManifest = await readFile('manifests/firefox-mv2.json', 'utf8');
await writeFile('dist-firefox/manifest.json', firefoxManifest);
