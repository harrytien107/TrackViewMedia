// Visual and interactive smoke test of the built popup with simulated extension APIs.
// This is NOT live-site validation or a replacement for loading dist/ as an extension.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const server = createServer(async (req, res) => {
  const path = resolve(root, decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, '')));
  if (!path.startsWith(`${root}${sep}`)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});

const sample = {
  platform: 'Instagram', username: 'ssam_kbbq', video_id: 'ABC_12',
  video_url: 'https://www.instagram.com/reel/ABC_12/', caption: 'Korean BBQ',
  published_at: '2026-11-18T12:00:00.000Z', views: '1.2K', views_exact: false,
  likes: 25, likes_exact: true, comments: null, comments_exact: null,
  collected_at: '2026-11-18T13:00:00.000Z',
};

let browser;
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 580 } });
  await page.addInitScript((record) => {
    const state = { [`selected:${record.platform}:${record.video_id}`]: record };
    window.chrome = {
      tabs: {
        query: async () => [{ url: 'https://www.instagram.com/ssam_kbbq/reels/', id: 1 }],
        sendMessage: async () => ({ platform: 'Instagram', username: 'ssam_kbbq', kind: 'profile' }),
      },
      storage: {
        local: {
          get: async () => ({ ...state }),
          remove: async (keys) => { for (const key of keys) delete state[key]; },
        },
        onChanged: { addListener() {}, removeListener() {} },
      },
      downloads: {
        download: async (options) => {
          window.__downloaded = {
            filename: options.filename,
            text: await (await fetch(options.url)).text(),
          };
          return 1;
        },
      },
    };
  }, sample);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  await page.getByText('1', { exact: true }).first().waitFor();
  if (!(await page.locator('body').innerText()).includes('ssam_kbbq')) throw new Error('Current profile missing');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  await page.getByText('Exported 1 selected video.').waitFor();
  const download = await page.evaluate(() => window.__downloaded);
  const actual = JSON.parse(download.text);
  if (download.filename.endsWith('.json') !== true || actual.length !== 1 || actual[0].video_id !== sample.video_id) {
    throw new Error('Incorrect exported JSON');
  }
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await page.getByText('Selections cleared.').waitFor();
  if (pageErrors.length) throw new Error(`Popup runtime errors: ${pageErrors.join('; ')}`);
  console.log('Popup smoke test passed: profile, selection count, JSON export, clear.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
