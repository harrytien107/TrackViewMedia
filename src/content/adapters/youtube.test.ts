// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.youtube.com/@SSam-2026/shorts"}
import { describe, expect, it, vi } from 'vitest';
import { youtube } from './youtube';

describe('YouTube Shorts adapter', () => {
  it('discovers Shorts tiles and reads the visible compact view count', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 338, left: 0, top: 0, right: 190, bottom: 338,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.innerHTML = `
      <ytd-rich-grid-slim-media>
        <a id="thumbnail" href="/shorts/AbC_123-def"><img alt="Steak short" src="x"></a>
        <div id="metadata"><span aria-label="1.2K views">1.2K views</span></div>
      </ytd-rich-grid-slim-media>`;

    expect(youtube.discover()).toEqual([
      expect.objectContaining({
        identity: {
          id: 'AbC_123-def',
          url: 'https://www.youtube.com/shorts/AbC_123-def',
          username: null,
        },
        metadata: expect.objectContaining({
          views: '1.2K', views_exact: false, views_source: 'tile',
        }),
      }),
    ]);
    vi.restoreAllMocks();
  });

  it('reads the visible Shorts view text even without aria-label metadata', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 338, left: 0, top: 0, right: 190, bottom: 338,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.innerHTML = `
      <yt-lockup-view-model>
        <a href="/shorts/ZyX_987-abc"><img alt="Steak short" src="x"></a>
        <div class="shortsLockupViewModelHostMetadataSubhead"><span>7.4K views</span></div>
      </yt-lockup-view-model>`;

    expect(youtube.discover()[0].metadata).toMatchObject({
      views: '7.4K', views_exact: false, views_source: 'tile',
    });
    vi.restoreAllMocks();
  });
});
