import { describe, expect, it } from 'vitest';
import { localDate, mergeMetadata, metadataFromScriptTexts, metadataFromStructuredData, metadataFromTile, metadataFromVideoHtml, parseMetric, verifiedTimestamp } from './metadata';

describe('publication times', () => {
  it('accepts exact timezone-aware times and unix seconds', () => {
    expect(verifiedTimestamp('2026-10-21T09:11:12+07:00')).toBe('2026-10-21T02:11:12.000Z');
    expect(verifiedTimestamp('2026-10-21T09:11:12+0700')).toBe('2026-10-21T02:11:12.000Z');
    expect(verifiedTimestamp('1792548672')).toBe('2026-10-21T02:11:12.000Z');
  });
  it('never invents a time from a date-only or timezone-less value', () => {
    expect(verifiedTimestamp('2026-10-21')).toBeNull();
    expect(verifiedTimestamp('2026-10-21T09:11:12')).toBeNull();
    expect(verifiedTimestamp('2026-99-99T09:11:12Z')).toBeNull();
    expect(localDate(null).short).toBe('Date unavailable');
  });
});

describe('metric accuracy', () => {
  it('preserves exact counts and clearly flags abbreviations', () => {
    expect(parseMetric('1,204 views')).toEqual({ value: 1204, exact: true });
    expect(parseMetric('1.2M')).toEqual({ value: '1.2M', exact: false });
    expect(parseMetric('lots of views')).toEqual({ value: null, exact: null });
    expect(mergeMetadata({ views: 1204, views_exact: true }, { views: '1.2K', views_exact: false }))
      .toEqual({ views: 1204, views_exact: true });
  });
});

describe('metadata extraction', () => {
  it('uses the matching video, not a neighboring TikTok video', () => {
    const json = JSON.stringify({ ItemModule: {
      '123': { id: '123', createTime: 1792548672, stats: { playCount: 2000 }, desc: 'first' },
      '456': { id: '456', createTime: 1792548800, stats: { playCount: 5000 }, desc: 'second' },
    } });
    const result = metadataFromScriptTexts([json], '123', 'TikTok');
    expect(result).toMatchObject({ published_at: '2026-10-21T02:11:12.000Z', views: 2000, caption: 'first' });
  });

  it('finds relevant metadata after unrelated hydration scripts', () => {
    const scripts = Array.from({ length: 40 }, (_, index) => JSON.stringify({ unrelated: index }));
    scripts.push(JSON.stringify({ reels: [{ creation_time: 1773878725, video: { id: '1130192402541878' } }] }));
    expect(metadataFromScriptTexts(scripts, '1130192402541878', 'Facebook').published_at)
      .toBe('2026-03-19T00:05:25.000Z');
  });

  it('reads timestamped single-video HTML and ignores date-only JSON-LD', () => {
    const html = `
      <meta content="2026-10-21T09:11:12+07:00" property="article:published_time">
      <meta property="og:description" content="Food &amp; drink">
      <script type="application/ld+json">{"@type":"VideoObject","uploadDate":"2026-10-21"}</script>`;
    expect(metadataFromVideoHtml(html, '123', 'Facebook'))
      .toMatchObject({ published_at: '2026-10-21T02:11:12.000Z', caption: 'Food & drink' });
    expect(metadataFromVideoHtml('<script type="application/ld+json">{"@type":"VideoObject","uploadDate":"2026-10-21"}</script>', '123', 'Facebook').published_at)
      .toBeUndefined();
  });

  it('rejects a timestamp from unrelated JSON-LD video objects', () => {
    const unrelated = '<script type="application/ld+json">{"@type":"VideoObject","url":"https://www.facebook.com/reel/999","uploadDate":"2026-10-21T09:11:12+07:00"}</script>';
    const matching = '<script type="application/ld+json">{"@type":"VideoObject","url":"https://www.facebook.com/reel/123","uploadDate":"2026-10-21T09:11:12+07:00"}</script>';
    expect(metadataFromVideoHtml(unrelated, '123', 'Facebook').published_at).toBeUndefined();
    expect(metadataFromVideoHtml(unrelated + matching, '123', 'Facebook').published_at)
      .toBe('2026-10-21T02:11:12.000Z');
  });

  it('matches an Instagram Reel post date without using comment timestamps', () => {
    const html = `<meta property="og:description" content="49 likes - user on January 21, 2025: hello">
      <a href="/p/DFHmVC0zHkj/c/18084466375592057/"><time datetime="2025-02-14T12:34:46.000Z">February 14, 2025</time></a>
      <a href="/ssam_kbbq/reel/DFHmVC0zHkj/"><time datetime="2025-01-22T07:02:34.000Z" title="Jan 21, 2025">January 21, 2025</time></a>`;
    expect(metadataFromVideoHtml(html, 'DFHmVC0zHkj', 'Instagram').published_at)
      .toBe('2025-01-22T07:02:34.000Z');
  });

  it('uses the timestamp inside the matching Instagram Reel permalink', () => {
    const html = `<meta property="og:description" content="A caption without a publication date">
      <a href="/ssam_kbbq/reel/DFHmVC0zHkj/"><time datetime="2025-01-22T07:02:34.000Z">January 21, 2025</time></a>
      <a href="/p/DFHmVC0zHkj/c/18084466375592057/"><time datetime="2025-02-14T12:34:46.000Z">February 14, 2025</time></a>`;
    expect(metadataFromVideoHtml(html, 'DFHmVC0zHkj', 'Instagram').published_at)
      .toBe('2025-01-22T07:02:34.000Z');
  });

  it('does not treat an Instagram comment timestamp as the Reel publication date', () => {
    const html = `<meta property="og:description" content="Posted January 21, 2025">
      <a href="/p/DFHmVC0zHkj/c/18084466375592057/"><time datetime="2025-02-14T12:34:46.000Z">January 21, 2025</time></a>`;
    expect(metadataFromVideoHtml(html, 'DFHmVC0zHkj', 'Instagram').published_at).toBeUndefined();
  });

  it('associates Facebook creation time with the matching Reel inside its story', () => {
    const data = { video: { id: '1130192402541878', creation_story: {
      id: 'UzpfSTYxNTc0Nzg4MjI4MTIzOlZLOjExMzAxOTI0MDI1NDE4Nzg=',
      creation_time: 1773878725,
      video: { id: '1130192402541878' },
      short_form_video_context: { playback_video: { id: '1130192402541878' } },
    } } };
    expect(metadataFromStructuredData(data, '1130192402541878', 'Facebook').published_at)
      .toBe('2026-03-19T00:05:25.000Z');
  });

  it('reads a Facebook profile Reel date from the story direct video ID', () => {
    const data = { all_collections: { nodes: [{ style_renderer: { collection: {
      aggregated_fb_shorts: { edges: [{ profile_reel_node: { node: {
        creation_time: 1773878725, video: { id: '1130192402541878' },
      } } }] },
    } } }] } };
    expect(metadataFromStructuredData(data, '1130192402541878', 'Facebook').published_at)
      .toBe('2026-03-19T00:05:25.000Z');
    expect(metadataFromStructuredData(data, '999999999', 'Facebook').published_at).toBeUndefined();
  });

  it('does not borrow a Facebook story time from a different video', () => {
    const data = { video: { id: '1130192402541878', creation_story: {
      creation_time: 1773878725,
      short_form_video_context: { playback_video: { id: '9999999999999999' } },
    } } };
    expect(metadataFromStructuredData(data, '1130192402541878', 'Facebook').published_at).toBeUndefined();
  });

  it('extracts only tile-scoped view counts', () => {
    document.body.innerHTML = `<a><img alt="Food reel"/><span aria-label="1.3K views"></span><time datetime="2026-10-21T09:11:12+07:00"></time></a>`;
    const data = metadataFromTile(document.querySelector('a')!);
    expect(data).toMatchObject({ caption: 'Food reel', published_at: '2026-10-21T02:11:12.000Z', views: '1.3K', views_exact: false });
  });
});
