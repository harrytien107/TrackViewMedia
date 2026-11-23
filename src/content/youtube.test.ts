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
});
