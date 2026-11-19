import { build } from 'esbuild';

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
