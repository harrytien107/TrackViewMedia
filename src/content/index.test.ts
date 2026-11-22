// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.tiktok.com/@chef"}
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('content script lifecycle (simulated public TikTok page)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('adds one overlay per tile, selects persistently and observes new thumbnails', async () => {
    vi.useFakeTimers();
    const stored: Record<string, unknown> = {};
    const storage = {
      get: vi.fn(async (keys: string | null) => {
        if (keys === null) return { ...stored };
        return { [keys]: stored[keys] };
      }),
      set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(stored, data); }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
      }),
    };
    const onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('chrome', {
      storage: { local: storage, onChanged },
      runtime: { sendMessage: vi.fn(async () => ({ metadata: null, status: 'unavailable', diagnostic: 'no_metadata' })), onMessage: { addListener: vi.fn() } },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);

    const tile = (id: string) => `<a href="/@chef/video/${id}"><img alt="Steak cooking" src="x" /><span data-e2e="video-views">1.2K</span><time datetime="2026-10-21T09:11:12+07:00"></time></a>`;
    document.body.innerHTML = `<section id="videos">${tile('123')}</section>`;
    const { stopTracking } = await import('./index');
    await vi.advanceTimersByTimeAsync(160);

    const list = document.querySelector('#videos')!;
    const first = list.querySelector('a')!;
    expect(first.querySelectorAll('[data-track-view-media="overlay"]')).toHaveLength(1);
    const shadow = first.querySelector<HTMLDivElement>('[data-track-view-media="overlay"]')!.shadowRoot!;
    expect(shadow.querySelector('.date')?.textContent).not.toBe('Date unavailable');
    expect(shadow.querySelector('.views')?.textContent).toBe('≈ 1.2K views');

    shadow.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await Promise.resolve();
    expect(stored['selected:TikTok:123']).toMatchObject({ video_id: '123', views: '1.2K', views_exact: false });
    expect(shadow.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');

    list.insertAdjacentHTML('beforeend', '<a href="/@chef/video/456"><img alt="Late-loaded video" src="x" /></a>');
    await vi.advanceTimersByTimeAsync(160);
    expect(list.querySelectorAll('[data-track-view-media="overlay"]')).toHaveLength(2);

    const lateOverlay = list.querySelectorAll<HTMLDivElement>('[data-track-view-media="overlay"]')[1];
    expect(lateOverlay.shadowRoot?.querySelector('.date')?.textContent).toBe('Date unavailable');
    expect(lateOverlay.shadowRoot?.querySelector('.diagnostics')?.getAttribute('title')).toContain('no_metadata');
    for (let index = 0; index < 35; index += 1) {
      const unrelated = document.createElement('script');
      unrelated.type = 'application/json';
      unrelated.textContent = JSON.stringify({ other: index });
      document.head.appendChild(unrelated);
    }
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify({ ItemModule: { '456': { id: '456', createTime: 1792548672 } } });
    document.head.appendChild(script);
    await vi.advanceTimersByTimeAsync(160);
    expect(lateOverlay.shadowRoot?.querySelector('.date')?.textContent).not.toBe('Date unavailable');

    await vi.advanceTimersByTimeAsync(500);
    expect(list.querySelectorAll('[data-track-view-media="overlay"]')).toHaveLength(2);
    stopTracking();
  });
});

describe('automatic metadata lookup scheduling', () => {
  let shutdown: (() => void) | null = null;
  afterEach(() => {
    shutdown?.();
    shutdown = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts up to three visible missing-date lookups concurrently', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const pending: Array<(value: unknown) => void> = [];
    const sendMessage = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.innerHTML = Array.from({ length: 4 }, (_, index) =>
      `<a href="/@chef/video/${100 + index}"><img alt="Video ${index}" src="x" /><span data-e2e="video-views">${index + 1}K</span></a>`,
    ).join('');

    const module = await import('./index');
    shutdown = module.stopTracking;
    await vi.advanceTimersByTimeAsync(170);
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(Array.from(document.querySelectorAll<HTMLDivElement>('[data-track-view-media="overlay"]'))
      .filter((overlay) => overlay.shadowRoot?.querySelector('.date')?.textContent === 'Loading date...'))
      .toHaveLength(4);

    for (const resolve of pending.splice(0)) resolve({ metadata: null, status: 'unavailable', diagnostic: 'no_video_date' });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledTimes(4);
    for (const resolve of pending.splice(0)) resolve({ metadata: null, status: 'unavailable', diagnostic: 'no_video_date' });
  });
});
