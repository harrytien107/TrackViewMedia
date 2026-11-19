import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const targets = [
  ['Instagram', 'https://www.instagram.com/ssam_kbbq/reels/'],
  ['TikTok', 'https://www.tiktok.com/@tungthitsizzlingsteak'],
  ['Facebook', 'https://www.facebook.com/profile.php?id=61574788228123&sk=reels_tab'],
].filter(([platform]) => !process.env.TVM_PLATFORM || platform === process.env.TVM_PLATFORM);
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const bundle = await readFile('dist/content.js', 'utf8');

try {
  for (const [platform, url] of targets) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = {};
      const listeners = [];
      window.chrome = {
        runtime: {
          sendMessage: async () => ({ metadata: null }),
          onMessage: { addListener() {} },
        },
        storage: {
          local: {
            async get(keys) {
              if (keys === null) return { ...state };
              if (typeof keys === 'string') return { [keys]: state[keys] };
              return Object.fromEntries(keys.map((key) => [key, state[key]]));
            },
            async set(entries) {
              for (const [key, value] of Object.entries(entries)) {
                const oldValue = state[key];
                state[key] = value;
                for (const listener of listeners) listener({ [key]: { oldValue, newValue: value } }, 'local');
              }
            },
            async remove(keys) {
              for (const key of Array.isArray(keys) ? keys : [keys]) {
                const oldValue = state[key];
                delete state[key];
                for (const listener of listeners) listener({ [key]: { oldValue } }, 'local');
              }
            },
          },
          onChanged: { addListener: (fn) => listeners.push(fn) },
        },
      };
    });
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      const preview = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/reel/"], a[href*="/video/"]')).filter((a) => {
        const r = a.getBoundingClientRect(); return r.width > 90 && r.height > 90;
      }).slice(0, 3).map((a) => ({
        url: a.href, text: a.innerText.slice(0, 90),
        icons: Array.from(a.querySelectorAll('[aria-label],svg[aria-label]')).slice(0, 6).map((el) => el.getAttribute('aria-label')),
      })));
      await page.evaluate(bundle);
      await page.waitForTimeout(600);
      const observed = await page.evaluate(() => Array.from(document.querySelectorAll('[data-track-view-media="overlay"]')).map((node) => ({
        date: node.shadowRoot?.querySelector('.date')?.textContent,
        views: node.shadowRoot?.querySelector('.views')?.textContent,
      })));
      const scripts = platform === 'Facebook' ? await page.evaluate(() => {
        const target = '1130192402541878';
        const selected = Array.from(document.querySelectorAll('script[type="application/json"], script[id="SIGI_STATE"], script[id="__NEXT_DATA__"], script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]'));
        return {
          count: selected.length,
          matches: selected.map((script, index) => ({ index, size: script.textContent?.length, hasVideo: script.textContent?.includes(target), hasCreation: script.textContent?.includes('1773878725') }))
            .filter((entry) => entry.hasVideo || entry.hasCreation).slice(0, 15),
        };
      }) : undefined;
      const tiktokState = platform === 'TikTok' ? await page.evaluate(() => ({
        body: document.body?.innerText.slice(0, 250),
        links: document.querySelectorAll('a[href*="/video/"]').length,
        hydration: Array.from(document.scripts).filter((node) => /SIGI_STATE|UNIVERSAL_DATA_FOR_REHYDRATION/.test(node.id))
          .map((node) => ({ id: node.id, length: node.textContent?.length, hasCreateTime: node.textContent?.includes('createTime') })),
      })) : undefined;
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(600);
      const countAfterScroll = await page.locator('[data-track-view-media="overlay"]').count();
      console.log(JSON.stringify({ platform, status: response?.status(), url: page.url(), preview, overlays: observed.slice(0, 3), before: observed.length, afterScroll: countAfterScroll, scripts, tiktokState, errors: errors.slice(0, 2) }));
    } catch (error) {
      console.log(JSON.stringify({ platform, error: String(error), pageErrors: errors.slice(0, 2) }));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
