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
    document.body.innerHTML = `<a href="/reel/${id}"><img alt="Reel preview" src="x" /></a>`;
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
});
