import { describe, expect, it, vi } from 'vitest';
import { allSelections, clearSelections, getVerifiedMetadata, removeSelection, saveSelection, saveVerifiedMetadata } from './storage';
import { parseUserDate } from './metadata';
import { toCsv, toJson } from './export';
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

  it('retains manual date precision in selected exports and across selection clearing', async () => {
    const entries: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: { local: {
        get: vi.fn(async (key: string | null) =>
          key === null ? { ...entries } : { [key]: entries[key] }),
        set: vi.fn(async (added: Record<string, unknown>) => Object.assign(entries, added)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete entries[key];
        }),
      } },
    });
    const record: VideoRecord = {
      platform: 'TikTok', username: 'chef', video_id: '123',
      video_url: 'https://www.tiktok.com/@chef/video/123', caption: 'Some caption',
      published_at: '2026-11-17T11:00:00.000Z', published_date: null,
      views: '1.2K', views_exact: false, likes: null, likes_exact: null,
      comments: null, comments_exact: null, collected_at: '2026-11-18T05:00:00.000Z',
    };
    await saveSelection(record);
    await saveVerifiedMetadata(record, {
      published_at: record.published_at,
      date_source: 'video_page',
      views: '1.2K', views_exact: false, views_source: 'video_page',
    });
    await saveVerifiedMetadata(record, parseUserDate('Nov 18')!);

    const selected = (await allSelections())[0];
    expect(selected).toMatchObject({
      published_at: null, published_date: null, published_label: 'Nov 18',
      date_source: 'manual', date_precision: 'month_day', views: '1.2K', views_exact: false,
    });
    expect(JSON.parse(toJson([selected]))[0]).toMatchObject({
      published_at: null, published_label: 'Nov 18', date_source: 'manual',
    });
    const csv = toCsv([selected]);
    expect(csv).toContain('published_at,published_date,published_label');
    expect(csv).toContain('"Nov 18"');
    expect(csv).toContain('"month_day","manual"');

    await clearSelections();
    expect(await allSelections()).toEqual([]);
    expect(await getVerifiedMetadata('TikTok', '123')).toMatchObject({
      published_label: 'Nov 18', date_source: 'manual',
      views: '1.2K', views_exact: false, views_source: 'video_page',
    });
    vi.unstubAllGlobals();
  });
});
