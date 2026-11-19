import { linkedVideos } from './common';
import type { Candidate } from '../../shared/types';

export const tiktok = {
  platform: 'TikTok' as const,
  discover(): Candidate[] {
    return linkedVideos('TikTok', 'a[href*="/video/"]');
  },
};
