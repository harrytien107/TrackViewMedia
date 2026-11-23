// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.youtube.com/@SSam-2026/shorts"}
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('YouTube Shorts content integration', () => {
  let shutdown: (() => void) | null = null;

  afterEach(() => {
    shutdown?.();
    shutdown = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adds overlays and resolves dates automatically for visible Shorts', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const stored: Record<string, unknown> = {};
    const sendMessage = vi.fn(async (request: { id: string }) => ({
      metadata: {
        published_date: request.id === 'AbC_123-def' ? '2026-11-18' : '2026-11-19',
        date_source: 'video_page',
      },
      status: 'resolved',
      diagnostic: 'matched_video_metadata',
    }));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string | null) => key === null ? { ...stored } : { [key]: stored[key] }),
          set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(stored, entries); }),
          remove: vi.fn(async (key: string) => { delete stored[key]; }),
        },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 338, left: 0, top: 0, right: 190, bottom: 338,
      toJSON: () => ({}),
    } as DOMRect);

    const tile = (id: string, views: string) => `
      <ytd-rich-grid-slim-media>
        <a id="thumbnail" href="/shorts/${id}"><img alt="Short ${id}" src="x"></a>
        <div id="metadata"><span aria-label="${views} views">${views} views</span></div>
      </ytd-rich-grid-slim-media>`;
    document.body.innerHTML = `<section id="shorts">${tile('AbC_123-def', '1.2K')}</section>`;

    const module = await import('./index');
    shutdown = module.stopTracking;
    await vi.advanceTimersByTimeAsync(170);
    await Promise.resolve();
    await Promise.resolve();

    const overlays = () => document.querySelectorAll<HTMLDivElement>('[data-track-view-media="overlay"]');
    expect(overlays()).toHaveLength(1);
    expect(overlays()[0].parentElement?.matches('a[href*="/shorts/"]')).toBe(true);
    expect(overlays()[0].shadowRoot?.querySelector('.date')?.textContent).toContain('2026');
    expect(overlays()[0].shadowRoot?.querySelector('.views')?.textContent).toBe('≈ 1.2K views');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'YouTube', id: 'AbC_123-def',
      url: 'https://www.youtube.com/shorts/AbC_123-def',
    }));

    document.querySelector('#shorts')?.insertAdjacentHTML('beforeend', tile('ZyX_987-abc', '2.3K'));
    await vi.advanceTimersByTimeAsync(170);
    await Promise.resolve();
    await Promise.resolve();
    expect(overlays()).toHaveLength(2);
    expect(overlays()[1].shadowRoot?.querySelector('.date')?.textContent).toContain('2026');
    expect(overlays()[1].shadowRoot?.querySelector('.views')?.textContent).toBe('≈ 2.3K views');
  });

  it('uses profile hydration for more than 30 Shorts without consuming fallback requests', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const stored: Record<string, unknown> = {};
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string | null) => key === null ? { ...stored } : { [key]: stored[key] }),
          set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(stored, entries); }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
          }),
        },
        onChanged: { addListener: vi.fn() },
      },
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 338, left: 0, top: 0, right: 190, bottom: 338,
      toJSON: () => ({}),
    } as DOMRect);

    const items = Array.from({ length: 36 }, (_, index) => {
      const id = `Short${String(index).padStart(5, '0')}`;
      return {
        id,
        renderer: {
          shortsLockupViewModel: {
            onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } },
            publishedTimeText: { simpleText: `Nov ${String((index % 20) + 1)}, 2026` },
          },
        },
      };
    });
    document.body.innerHTML = `
      <script>var ytInitialData = ${JSON.stringify({ contents: items.map((item) => item.renderer) })};</script>
      <section>${items.map((item) => `
        <ytd-rich-grid-slim-media>
          <a href="/shorts/${item.id}"><img alt="Short ${item.id}"></a>
          <span aria-label="1.2K views">1.2K views</span>
        </ytd-rich-grid-slim-media>`).join('')}</section>`;

    const module = await import('./index');
    shutdown = module.stopTracking;
    await vi.advanceTimersByTimeAsync(180);
    await Promise.resolve();
    await Promise.resolve();

    const overlays = document.querySelectorAll<HTMLDivElement>('[data-track-view-media="overlay"]');
    expect(overlays).toHaveLength(36);
    expect(Array.from(overlays).every((overlay) =>
      overlay.shadowRoot?.querySelector('.date')?.textContent?.includes('2026'))).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
