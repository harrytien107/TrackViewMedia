import { describe, expect, it, vi } from 'vitest';
import { allSelections, clearSelections, removeSelection, saveSelection } from './storage';
import type { VideoRecord } from './types';

describe('persistent selected videos', () => {
  it('restores selections and clears them without deleting metadata caches', async () => {
    const entries: Record<string, unknown> = { 'metadata:Instagram:ABC': { timestamp: 1 } };
    vi.stubGlobal('chrome', {
      storage: { local: {
        get: vi.fn(async () => ({ ...entries })),
        set: vi.fn(async (added: Record<string, unknown>) => Object.assign(entries, added)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete entries[key];
        }),
      } },
    });
    const record: VideoRecord = {
      platform: 'Instagram', username: 'ssam_kbbq', video_id: 'ABC',
      video_url: 'https://www.instagram.com/reel/ABC/', caption: null,
      published_at: null, published_date: null, views: null, views_exact: null,
      likes: null, likes_exact: null, comments: null, comments_exact: null,
      collected_at: '2026-11-18T05:00:00.000Z',
    };
    await saveSelection(record);
    expect(await allSelections()).toEqual([record]);
    await removeSelection(record);
    expect(await allSelections()).toEqual([]);
    await saveSelection(record);
    await clearSelections();
    expect(await allSelections()).toEqual([]);
    expect(entries['metadata:Instagram:ABC']).toBeDefined();
    vi.unstubAllGlobals();
  });
});
