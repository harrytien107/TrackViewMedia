import { metadataFromTile, parseMetric } from '../../shared/metadata';
import { identityFromUrl } from '../../shared/urls';
import type { Candidate } from '../../shared/types';

const TILE_SELECTOR = [
  'ytd-rich-grid-slim-media',
  'ytd-reel-item-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model',
  '[class*="shortsLockupViewModel"]',
].join(', ');

function tileFor(anchor: HTMLAnchorElement): HTMLElement | null {
  const tile = anchor.closest<HTMLElement>(TILE_SELECTOR) ?? anchor;
  if (!tile.querySelector('img, video, [role="img"], [style*="background-image"]')) return null;
  const rect = tile.getBoundingClientRect();
  return rect.width >= 90 && rect.height >= 90 ? tile : null;
}

function visibleViewMetric(tile: HTMLElement): ReturnType<typeof parseMetric> | null {
  const candidates = [
    ...tile.querySelectorAll<HTMLElement>(
      '.shortsLockupViewModelHostMetadataSubhead, #metadata-line span, #metadata span, span, div',
    ),
  ];
  for (const element of candidates) {
    if (element.closest('[data-track-view-media]')) continue;
    const text = element.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    const match = text.match(/(?:^|\s)(\d[\d,.]*\s*[KMB]?)\s+(?:views?|lượt xem)(?:\s|$)/i);
    if (!match) continue;
    const metric = parseMetric(match[1]);
    if (metric.value !== null) return metric;
  }
  return null;
}

export const youtube = {
  platform: 'YouTube' as const,
  discover(): Candidate[] {
    const videos: Candidate[] = [];
    const seen = new Set<HTMLElement>();
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/shorts/"]')) {
      if (videos.length >= 300) break;
      const identity = identityFromUrl(anchor.href, 'YouTube');
      const tile = tileFor(anchor);
      if (!identity || !tile || seen.has(tile)) continue;
      seen.add(tile);
      const metadata = metadataFromTile(tile, 'YouTube');
      const visibleMetric = visibleViewMetric(tile);
      if (visibleMetric) {
        metadata.views = visibleMetric.value;
        metadata.views_exact = visibleMetric.exact;
        metadata.views_source = 'tile';
      } else if (metadata.views === undefined || metadata.views === null) {
        for (const element of tile.querySelectorAll<HTMLElement>('[aria-label], #metadata-line span, .shortsLockupViewModelHostMetadataSubhead')) {
          const raw = element.getAttribute('aria-label') ?? element.textContent ?? '';
          const match = raw.match(/(\d[\d,.]*\s*[KMB]?)\s+views?\b/i);
          if (!match) continue;
          const metric = parseMetric(match[1]);
          if (metric.value === null) continue;
          metadata.views = metric.value;
          metadata.views_exact = metric.exact;
          metadata.views_source = 'tile';
          break;
        }
      }
      videos.push({ anchor, tile, identity, metadata });
    }
    return videos;
  },
};
