import { describe, expect, it, vi } from 'vitest';

describe('metadata fallback cache', () => {
  it('retries incomplete metadata sooner and retains complete data longer', async () => {
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn() } } });
    const { cacheLifetime } = await import('./index');
    expect(cacheLifetime(null)).toBe(15 * 60_000);
    expect(cacheLifetime({ views: '1.2K', views_exact: false })).toBe(10 * 60_000);
    expect(cacheLifetime({ published_relative: '2 days ago', views: 100 })).toBe(10 * 60_000);
    expect(cacheLifetime({ published_date: '2026-11-18' })).toBe(7 * 24 * 60 * 60_000);
    expect(cacheLifetime({ published_at: '2026-10-21T02:11:12.000Z', views: 100 })).toBe(7 * 24 * 60 * 60_000);
    vi.unstubAllGlobals();
  });

  it('deletes expired fallback entries and caps transient cache size', async () => {
    vi.resetModules();
    const now = Date.now();
    const state: Record<string, unknown> = {
      'metadata:v5:Instagram:expired': { timestamp: now - 8 * 24 * 60 * 60_000, metadata: { published_date: '2026-01-01' } },
      'metadata:v5:TikTok:expired': { timestamp: now - 20 * 60_000, metadata: null },
      'metadata:v5:Facebook:expired': { timestamp: now - 20 * 60_000, metadata: { views: '1K' } },
      'metadata:v5:YouTube:expired': { timestamp: now - 20 * 60_000, metadata: null },
      'verified:Facebook:keep': { published_date: '2026-11-01' },
      'selected:Facebook:keep': { video_id: 'keep' },
    };
    for (let index = 0; index < 125; index += 1) {
      state[`metadata:v5:YouTube:fresh-${index}`] = {
        timestamp: now - index * 1000,
        metadata: { published_date: '2026-11-18' },
      };
    }
    vi.stubGlobal('chrome', {
      storage: { local: {
        get: async (key: string | null) => key === null ? { ...state } : { [key]: state[key] },
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
        },
      } },
      runtime: { onMessage: { addListener: vi.fn() } },
    });
    const { cleanupFallbackCache } = await import('./index');
    expect(await cleanupFallbackCache(now)).toBe(120);
    expect(Object.keys(state).filter((key) => key.startsWith('metadata:v5:'))).toHaveLength(120);
    expect(state['metadata:v5:Instagram:expired']).toBeUndefined();
    expect(state['metadata:v5:TikTok:expired']).toBeUndefined();
    expect(state['metadata:v5:Facebook:expired']).toBeUndefined();
    expect(state['metadata:v5:YouTube:expired']).toBeUndefined();
    expect(state['verified:Facebook:keep']).toBeDefined();
    expect(state['selected:Facebook:keep']).toBeDefined();
    vi.unstubAllGlobals();
  });
});

describe('tab-origin metadata fallback', () => {
  it('accepts a YouTube Short and keeps its resolver rate state independent', async () => {
    vi.resetModules();
    const state: Record<string, unknown> = {};
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const pageFetch = vi.fn(async () => ({
      metadata: { published_date: '2026-11-18', date_source: 'video_page' },
      diagnostic: 'matched_video_date',
    }));
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: pageFetch },
      storage: { local: {
        get: async (key: string) => ({ [key]: state[key] }),
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');

    const result = await new Promise<{ status: string; metadata: { published_date: string } }>((resolve) =>
      listener?.(
        {
          type: 'resolve-metadata',
          platform: 'YouTube',
          id: 'AbC_123-def',
          url: 'https://www.youtube.com/shorts/AbC_123-def',
        },
        { tab: { id: 8 }, url: 'https://www.youtube.com/@SSam-2026/shorts' } as chrome.runtime.MessageSender,
        resolve as (value: unknown) => void,
      ));

    expect(result.status).toBe('resolved');
    expect(result.metadata.published_date).toBe('2026-11-18');
    expect(pageFetch).toHaveBeenCalledOnce();
    expect(state['metadata_request_history:YouTube']).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('allows YouTube fallback beyond 30 requests but caps it at 120 per five minutes', async () => {
    vi.resetModules();
    const now = Date.now();
    const state: Record<string, unknown> = {
      'metadata_request_history:YouTube': Array.from({ length: 30 }, (_, index) => now - index * 1000),
    };
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const pageFetch = vi.fn(async () => ({
      metadata: { published_date: '2026-11-18', date_source: 'video_page' },
      diagnostic: 'matched_video_date',
    }));
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: pageFetch },
      storage: { local: {
        get: async (key: string | null) => key === null ? { ...state } : { [key]: state[key] },
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key];
        },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');

    const result = await new Promise<{ status: string }>((resolve) => listener?.(
      {
        type: 'resolve-metadata',
        platform: 'YouTube',
        id: 'AbC_123-def',
        url: 'https://www.youtube.com/shorts/AbC_123-def',
      },
      { tab: { id: 8 }, url: 'https://www.youtube.com/@SSam-2026/shorts' } as chrome.runtime.MessageSender,
      resolve as (value: unknown) => void,
    ));

    expect(result.status).toBe('resolved');
    expect(pageFetch).toHaveBeenCalledOnce();

    state['metadata_request_history:YouTube'] = Array.from({ length: 120 }, (_, index) => now - index * 1000);
    const limited = await new Promise<{ status: string }>((resolve) => listener?.(
      {
        type: 'resolve-metadata',
        platform: 'YouTube',
        id: 'ZyX_987-abc',
        url: 'https://www.youtube.com/shorts/ZyX_987-abc',
      },
      { tab: { id: 8 }, url: 'https://www.youtube.com/@SSam-2026/shorts' } as chrome.runtime.MessageSender,
      resolve as (value: unknown) => void,
    ));
    expect(limited.status).toBe('rate_limited');
    expect(pageFetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('allows the Facebook pagination batch beyond the default 12-request window', async () => {
    vi.resetModules();
    const now = Date.now();
    const state: Record<string, unknown> = {
      'metadata_request_history:Facebook': Array.from({ length: 12 }, (_, index) => now - 10_000 - index),
      'metadata_request_history:Instagram': Array.from({ length: 12 }, (_, index) => now - 10_000 - index),
    };
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const pageFetch = vi.fn(async (request: { platform: string }) => ({
      metadata: { published_date: '2026-01-22', date_source: 'video_page' },
      diagnostic: `matched_${request.platform.toLowerCase()}_date`,
    }));
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: (_tabId: number, request: { platform: string }) => pageFetch(request) },
      storage: { local: {
        get: async (key: string) => ({ [key]: state[key] }),
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');

    const send = (platform: 'Facebook' | 'Instagram', id: string, url: string, senderUrl: string) =>
      new Promise<{ status: string }>((resolve) => listener?.(
        { type: 'resolve-metadata', platform, id, url },
        { tab: { id: platform === 'Facebook' ? 3 : 4 }, url: senderUrl } as chrome.runtime.MessageSender,
        resolve as (value: unknown) => void,
      ));
    const facebook = await send('Facebook', '1802910940416819',
      'https://www.facebook.com/reel/1802910940416819',
      'https://www.facebook.com/profile.php?id=61574788228123&sk=reels_tab');
    const instagram = await send('Instagram', 'ABC123',
      'https://www.instagram.com/reel/ABC123/', 'https://www.instagram.com/example/reels/');

    expect(facebook.status).toBe('resolved');
    expect(instagram.status).toBe('rate_limited');
    expect(pageFetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

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

  it('does not serialize automatic lookups from different platforms behind one request', async () => {
    vi.resetModules();
    const state: Record<string, unknown> = {};
    let listener: ((request: unknown, sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void) => boolean) | undefined;
    const resolvers = new Map<string, (value: unknown) => void>();
    const pageFetch = vi.fn((request: { platform: string }) => new Promise((resolve) => {
      resolvers.set(request.platform, resolve);
    }));
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      tabs: { sendMessage: (_tabId: number, request: { platform: string }) => pageFetch(request) },
      storage: { local: {
        get: async (key: string) => ({ [key]: state[key] }),
        set: async (entries: Record<string, unknown>) => { Object.assign(state, entries); },
      } },
      runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    });
    await import('./index');

    const send = (platform: 'Instagram' | 'TikTok', id: string, url: string, senderUrl: string) =>
      new Promise((resolve) => listener?.(
        { type: 'resolve-metadata', platform, id, url },
        { tab: { id: platform === 'Instagram' ? 1 : 2 }, url: senderUrl } as chrome.runtime.MessageSender,
        resolve,
      ));
    const instagram = send('Instagram', 'ABC123', 'https://www.instagram.com/reel/ABC123/',
      'https://www.instagram.com/example/reels/');
    const tiktok = send('TikTok', '7709061097264860434',
      'https://www.tiktok.com/@chef/video/7709061097264860434', 'https://www.tiktok.com/@chef');

    await vi.waitFor(() => expect(pageFetch).toHaveBeenCalledTimes(2));
    resolvers.get('Instagram')?.({ metadata: { published_date: '2026-11-01' }, diagnostic: 'matched_video_date' });
    resolvers.get('TikTok')?.({ metadata: { published_at: '2026-11-17T08:54:35.000Z' }, diagnostic: 'matched_video_date' });
    await Promise.all([instagram, tiktok]);
    vi.unstubAllGlobals();
  });
});
