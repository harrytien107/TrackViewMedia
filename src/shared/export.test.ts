import { describe, expect, it } from 'vitest';
import { toCsv, toJson } from './export';
import type { VideoRecord } from './types';

const selected: VideoRecord = {
  platform: 'TikTok', username: 'chef', video_id: '0012345',
  video_url: 'https://www.tiktok.com/@chef/video/0012345',
  caption: '=HYPERLINK("danger")', published_at: null, published_date: '2026-11-18',
  views: '1.2K', views_exact: false, likes: 120, likes_exact: true,
  comments: null, comments_exact: null, collected_at: '2026-11-18T05:00:00.000Z',
};

describe('selected-video exports', () => {
  it('preserves field types, identifiers and unavailable metadata in JSON', () => {
    expect(JSON.parse(toJson([selected]))).toEqual([selected]);
    expect(toJson([])).toBe('[]');
  });
  it('uses UTF-8 BOM, quotes dangerous cells, and leaves missing fields empty', () => {
    const csv = toCsv([selected]);
    expect(csv.startsWith('\ufeffplatform,username,video_id')).toBe(true);
    expect(csv).toContain('"0012345"');
    expect(csv).toContain('"\'=HYPERLINK(""danger"")"');
    expect(csv).toContain('"1.2K","false","120","true"');
    expect(csv).toContain('"0012345"');
  });
  it('exports relative dates as approximate without manufacturing published_at', () => {
    const approximate = {
      ...selected, published_at: null, published_date: null, published_relative: '3 days ago',
      date_precision: 'relative' as const, date_source: 'tile' as const,
    };
    const parsed = JSON.parse(toJson([approximate]))[0];
    expect(parsed.published_at).toBeNull();
    expect(parsed.date_precision).toBe('relative');
    expect(toCsv([approximate])).toContain('"3 days ago","relative","tile"');
  });
  it('exports a yearless platform date label without inventing an ISO date', () => {
    const dateLabel = {
      ...selected, published_at: null, published_date: null, published_label: 'Nov 18',
      date_precision: 'day' as const, date_source: 'tile' as const,
    };
    const parsed = JSON.parse(toJson([dateLabel]))[0];
    expect(parsed.published_at).toBeNull();
    expect(parsed.published_date).toBeNull();
    expect(parsed.published_label).toBe('Nov 18');
    expect(parsed.date_precision).toBe('day');
    expect(toCsv([dateLabel])).toContain('"Nov 18"');
  });
});
