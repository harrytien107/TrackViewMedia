// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.facebook.com/profile.php?id=61574788228123&sk=reels_tab"}
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Facebook late-loaded Reel metadata', () => {
  let shutdown: (() => void) | null = null;
  afterEach(() => { shutdown?.(); shutdown = null; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('refreshes dates after scripts arrive or change and keeps one overlay per tile', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({ metadata: null })),
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        onChanged: { addListener: vi.fn() },
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);
    const id = '1130192402541878';
    document.body.innerHTML = `<a href="/reel/${id}"><img alt="Reel preview" src="x" /><svg><path d="M3.707 5.488 test" /></svg><span>11.3K</span></a>`;
    const { stopTracking } = await import('./index');
    shutdown = stopTracking;
    await vi.advanceTimersByTimeAsync(170);
    const anchor = document.querySelector('a')!;
    const badge = () => anchor.querySelector<HTMLDivElement>('[data-track-view-media="overlay"]')!;
    expect(badge().shadowRoot?.querySelector('.date')?.textContent).toBe('Date unavailable');

    const data = (time: number) => JSON.stringify({ collection: { edges: [
      { node: { creation_time: time, short_form_video_context: { playback_video: { id } } } },
    ] } });
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = data(1773878725);
    document.head.appendChild(script);
    await vi.advanceTimersByTimeAsync(170);
    expect(badge().shadowRoot?.querySelector('.date')?.textContent).toContain('Mar');
    expect(badge().dataset.tvmDateSource).toBe('embedded');

    script.textContent = data(1773792325);
    await vi.advanceTimersByTimeAsync(170);
    expect(badge().shadowRoot?.querySelector('.date')?.textContent).toContain('Mar 18');
    expect(anchor.querySelectorAll('[data-track-view-media="overlay"]')).toHaveLength(1);
  });

  it('uses profile tracking publish_time without falling back to an individual Reel request', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const sendMessage = vi.fn(async () => ({ metadata: null, status: 'unavailable' }));
    vi.stubGlobal('chrome', {
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        onChanged: { addListener: vi.fn() },
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);
    const id = '1130192402541878';
    document.body.innerHTML = `<a href="/reel/${id}"><img alt="Reel preview" src="x" /><svg><path d="M3.707 5.488 test" /></svg><span>11.3K</span></a>`;
    const script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify({ collection: { edges: [{ profile_reel_node: { node: {
      tracking: JSON.stringify({
        top_level_post_id: id,
        video_id: id,
        post_context: { publish_time: 1773878725, story_fbid: [id] },
      }),
    } } }] } });
    document.head.appendChild(script);

    const { stopTracking } = await import('./index');
    shutdown = stopTracking;
    await vi.advanceTimersByTimeAsync(170);
    const overlay = document.querySelector<HTMLDivElement>('[data-track-view-media="overlay"]')!;
    expect(overlay.shadowRoot?.querySelector('.date')?.textContent).toContain('Mar');
    expect(overlay.dataset.tvmDateSource).toBe('embedded');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reuses a fallback-resolved Reel date immediately after opening a Reel and navigating back', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const stored: Record<string, unknown> = {};
    const sendMessage = vi.fn(async () => ({
      metadata: { published_at: '2026-01-23T01:02:56.000Z', date_source: 'video_page' },
      status: 'resolved',
    }));
    vi.stubGlobal('chrome', {
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
      storage: {
        local: {
          get: vi.fn(async (key: string | null) => key === null ? { ...stored } : { [key]: stored[key] }),
          set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(stored, entries); }),
          remove: vi.fn(async (key: string) => { delete stored[key]; }),
        },
        onChanged: { addListener: vi.fn() },
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);

    const id = '1802910940416819';
    const tile = () => `<a href="/reel/${id}"><img alt="Reel preview" src="x" />` +
      '<svg><path d="M3.707 5.488 test" /></svg><span>11.3K</span></a>';
    window.history.pushState({}, '', '/torder19/reels/');
    document.body.innerHTML = tile();

    const { stopTracking } = await import('./index');
    shutdown = stopTracking;
    await vi.advanceTimersByTimeAsync(220);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(stored[`verified:Facebook:${id}`]).toMatchObject({
      published_at: '2026-01-23T01:02:56.000Z',
      date_source: 'video_page',
    });

    window.history.pushState({}, '', `/reel/${id}`);
    document.body.innerHTML = '<main>Opened Reel</main>';
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(220);

    window.history.pushState({}, '', '/torder19/reels/');
    document.body.innerHTML = tile();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(220);

    const overlay = document.querySelector<HTMLDivElement>('[data-track-view-media="overlay"]')!;
    expect(overlay.shadowRoot?.querySelector('.date')?.textContent).toContain('Jan');
    expect(overlay.shadowRoot?.querySelector('.date')?.textContent).not.toBe('Loading date...');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
