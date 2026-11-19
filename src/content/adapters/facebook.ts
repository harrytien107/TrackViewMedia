import { linkedVideos } from './common';
import { parseMetric } from '../../shared/metadata';
import type { Candidate } from '../../shared/types';

export const facebook = {
  platform: 'Facebook' as const,
  discover(): Candidate[] {
    const candidates = linkedVideos('Facebook', 'a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch?"]');
    for (const candidate of candidates) {
      // Public Facebook Reel tiles sometimes have an unlabeled eye icon followed
      // by a single count; require that *specific* eye glyph before using it.
      const hasEye = Array.from(candidate.tile.querySelectorAll('svg path[d]')).some((path) =>
        path.getAttribute('d')?.startsWith('M3.707 5.488'));
      const text = candidate.tile.textContent?.trim();
      if (hasEye && text && /^\d[\d,.]*\s*[KMB]?$/i.test(text)) {
        const { value, exact } = parseMetric(text);
        if (value !== null) {
          candidate.metadata.views = value;
          candidate.metadata.views_exact = exact;
          candidate.metadata.views_source = 'tile';
        }
      }
    }
    return candidates;
  },
};
