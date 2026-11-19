import { identityFromUrl } from '../../shared/urls';
import { metadataFromTile } from '../../shared/metadata';
import type { Candidate, Platform } from '../../shared/types';

function usableTile(anchor: HTMLAnchorElement): HTMLElement | null {
  const hasPreview = (node: Element) => !!node.querySelector('img, video, [role="img"], [style*="background-image"]');
  // Facebook sometimes puts an empty link on top of a sibling thumbnail.
  const tile = hasPreview(anchor) ? anchor : anchor.parentElement;
  if (!tile || !hasPreview(tile)) return null;
  const rect = tile.getBoundingClientRect();
  // Don't put floating badges on tiny navigation links or text-only video links.
  if (rect.width < 90 || rect.height < 90) return null;
  return tile;
}

export function linkedVideos(platform: Platform, selector: string): Candidate[] {
  const videos: Candidate[] = [];
  const seenTiles = new Set<HTMLElement>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(selector)) {
    if (videos.length >= 300) break;
    const identity = identityFromUrl(anchor.href, platform);
    if (!identity) continue;
    const tile = usableTile(anchor);
    if (!tile || seenTiles.has(tile)) continue;
    seenTiles.add(tile);
    videos.push({ anchor, tile, identity, metadata: metadataFromTile(tile, platform) });
  }
  return videos;
}
