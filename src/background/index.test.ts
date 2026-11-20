import { describe, expect, it, vi } from 'vitest';

describe('metadata fallback cache', () => {
  it('retries incomplete metadata sooner and retains complete data longer', async () => {
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn() } } });
    const { cacheLifetime } = await import('./index');
    expect(cacheLifetime(null)).toBe(15 * 60_000);
    expect(cacheLifetime({ views: '1.2K', views_exact: false })).toBe(10 * 60_000);
    expect(cacheLifetime({ published_relative: '2 days ago', views: 100 })).toBe(10 * 60_000);
    expect(cacheLifetime({ published_at: '2026-10-21T02:11:12.000Z', views: 100 })).toBe(7 * 24 * 60 * 60_000);
    vi.unstubAllGlobals();
  });
});

describe('tab-origin metadata fallback', () => {
  it('uses the content page to retrieve a Reel timestamp and caches the result', async () => {
    vi.resetModules();
    const state: Record<string, unknown> = {};
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const pageFetch = vi.fn(async () => ({
      metadata: { published_at: '2025-01-22T07:02:34.000Z', views: 41000, date_source: 'video_page' },
      diagnostic: 'matched_video_date',
    }));
    const backgroundFetch = vi.fn();
    vi.stubGlobal('fetch', backgroundFetch);
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: pageFetch },
      storage: { local: {
        get: async (key: string) => ({ [key]: state[key] }),
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');
    const message = {
      type: 'resolve-metadata', platform: 'Instagram', id: 'DFHmVC0zHkj',
      url: 'https://www.instagram.com/reel/DFHmVC0zHkj/',
    };
    const sender = { tab: { id: 15 }, url: 'https://www.instagram.com/ssam_kbbq/reels/' } as chrome.runtime.MessageSender;
    const send = () => new Promise<unknown>((resolve) => listener?.(message, sender, resolve));

    const result = await send() as { metadata: { published_at: string }; status: string };
    expect(result.status).toBe('resolved');
    expect(result.metadata.published_at).toBe('2025-01-22T07:02:34.000Z');
    await send();
    expect(pageFetch).toHaveBeenCalledTimes(1);
    expect(backgroundFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('tries the alternate response when the tab HTML has no date', async () => {
    vi.resetModules();
    const state: Record<string, unknown> = {};
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const pageFetch = vi.fn(async () => ({ metadata: { views: 100 }, diagnostic: 'no_video_date' }));
    const backgroundFetch = vi.fn(async () => ({
      ok: true,
      url: 'https://www.instagram.com/reel/DFHmVC0zHkj/',
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => '<meta property="og:description" content="Video by Ssam Korean BBQ on January 21, 2025.">',
    }));
    vi.stubGlobal('fetch', backgroundFetch);
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: pageFetch },
      storage: { local: {
        get: async (key: string) => ({ [key]: state[key] }),
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');
    const message = {
      type: 'resolve-metadata', platform: 'Instagram', id: 'DFHmVC0zHkj',
      url: 'https://www.instagram.com/reel/DFHmVC0zHkj/',
    };
    const sender = { tab: { id: 15 }, url: 'https://www.instagram.com/ssam_kbbq/reels/' } as chrome.runtime.MessageSender;
    const result = await new Promise<{ metadata: { views: number; published_date: string }; status: string }>((resolve) =>
      listener?.(message, sender, resolve as (value: unknown) => void));

    expect(result.status).toBe('resolved');
    expect(result.metadata.views).toBe(100);
    expect(result.metadata.published_date).toBe('2025-01-21');
    expect(pageFetch).toHaveBeenCalledOnce();
    expect(backgroundFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
