import { linkedVideos } from './common';
import type { Candidate } from '../../shared/types';

export const instagram = {
  platform: 'Instagram' as const,
  discover(): Candidate[] {
    // The first version intentionally targets Reels, not ordinary image posts.
    return linkedVideos('Instagram', 'a[href*="/reel/"]');
  },
};
