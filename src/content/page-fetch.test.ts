// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.instagram.com/ssam_kbbq/reels/"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVideoFromPage } from './page-fetch';

const request = {
  type: 'fetch-video-from-page' as const,
  platform: 'Instagram' as const,
  id: 'DFHmVC0zHkj',
  url: 'https://www.instagram.com/reel/DFHmVC0zHkj/',
};

afterEach(() => vi.unstubAllGlobals());

describe('same-site video metadata lookup', () => {
  it('retrieves a verified Reel date using the visited site origin', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true, url, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<meta property="og:url" content="https://www.instagram.com/reel/DFHmVC0zHkj/">' +
        '<meta property="article:published_time" content="2025-01-22T07:02:34.000Z">',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchVideoFromPage(request);
    expect(result.metadata?.published_at).toBe('2025-01-22T07:02:34.000Z');
    expect(result.diagnostic).toBe('matched_video_date');
    expect(fetchMock).toHaveBeenCalledWith(request.url, expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('returns the publication day from Instagram attribution when no exact timestamp is exposed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, url, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<meta property="og:url" content="https://www.instagram.com/reel/DFHmVC0zHkj/">' +
        '<meta property="og:description" content="49 likes, 2 comments - ssam_kbbq on January 21, 2025: &quot;Food&quot;">',
    })));

    const result = await fetchVideoFromPage(request);
    expect(result.diagnostic).toBe('matched_video_date');
    expect(result.metadata).toMatchObject({ published_date: '2025-01-21', date_source: 'video_page' });
    expect(result.metadata?.published_at).toBeUndefined();
  });

  it('rejects metadata belonging to a different Reel', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, url, status: 200, headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<meta property="og:url" content="https://www.instagram.com/reel/ANOTHER/">' +
        '<meta property="article:published_time" content="2025-01-22T07:02:34.000Z">',
    })));

    const result = await fetchVideoFromPage(request);
    expect(result).toEqual({ metadata: null, diagnostic: 'page_identity_mismatch' });
  });

  it('does not request another platform from the current page', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchVideoFromPage({
      type: 'fetch-video-from-page', platform: 'Facebook', id: '1234',
      url: 'https://www.facebook.com/reel/1234',
    });
    expect(result.diagnostic).toBe('invalid_video_request');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
