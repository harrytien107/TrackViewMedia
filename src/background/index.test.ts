import { describe, expect, it, vi } from 'vitest';

describe('metadata fallback cache', () => {
  it('retries incomplete metadata sooner and retains complete data longer', async () => {
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn() } } });
    const { cacheLifetime } = await import('./index');
    expect(cacheLifetime(null)).toBe(30 * 60_000);
    expect(cacheLifetime({ views: '1.2K', views_exact: false })).toBe(20 * 60_000);
    expect(cacheLifetime({ published_relative: '2 days ago', views: 100 })).toBe(20 * 60_000);
    expect(cacheLifetime({ published_at: '2026-10-21T02:11:12.000Z', views: 100 })).toBe(7 * 24 * 60 * 60_000);
    vi.unstubAllGlobals();
  });
});
