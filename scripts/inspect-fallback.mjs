import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const background = await readFile('dist/background.js', 'utf8');
const platform = process.env.TVM_PLATFORM || 'Instagram';
const id = process.env.TVM_VIDEO_ID || 'DFHmVC0zHkj';
const url = process.env.TVM_VIDEO_URL || 'https://www.instagram.com/reel/DFHmVC0zHkj/';
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const data = {};
    const listeners = [];
    window.chrome = {
      storage: { local: {
        get: async (key) => key === null ? { ...data } : { [key]: data[key] },
        set: async (input) => Object.assign(data, input),
      } },
      runtime: {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        sendMessage: (message) => new Promise((resolve) => {
          for (const listener of listeners) {
            if (listener(message, {}, resolve)) return;
          }
          resolve({ metadata: null });
        }),
      },
    };
  });
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(background);
  const result = await page.evaluate(async ({ target, platform, id }) => {
    const times = Array.from(document.querySelectorAll('time[datetime]')).slice(0, 6).map((el) => ({
      datetime: el.getAttribute('datetime'),
      text: el.textContent?.trim(),
      parent: el.parentElement?.outerHTML.slice(0, 400),
    }));
    const metadata = await chrome.runtime.sendMessage({
      type: 'resolve-metadata', platform, id, url: target,
    });
    return { times, metadata };
  }, { target: url, platform, id });
  console.log(JSON.stringify({ platform, id, status: response?.status(), url: page.url(), result }));
} finally {
  await browser.close();
}
