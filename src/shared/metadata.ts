import type { DatePrecision, MetadataSource, Metric, Platform, VideoMetadata } from './types';
import { identityFromUrl } from './urls';

const instantRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Do not interpret date-only strings or timezone-less clock times as exact instants. */
export function verifiedTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const str = String(value).trim();
  let ms: number;
  if (/^\d{10}$/.test(str)) ms = Number(str) * 1000;
  else if (/^\d{13}$/.test(str)) ms = Number(str);
  else if (instantRe.test(str)) {
    ms = Date.parse(str.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  } else return null;
  if (!Number.isFinite(ms) || ms < Date.UTC(2005, 0, 1) || ms > Date.now() + 86_400_000) return null;
  return new Date(ms).toISOString();
}

/** A source-provided calendar date; do not invent a publication time or timezone. */
export function verifiedCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[/.]/g, '-');
  const numeric = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year: number, month: number, day: number;
  if (numeric) {
    [, year, month, day] = numeric.map(Number);
  } else {
    const names = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const english = normalized.match(/^(?:(\d{1,2})\s+([a-z]+)\s+(\d{4})|([a-z]+)\s+(\d{1,2}),?\s+(\d{4}))$/i);
    if (!english) return null;
    const name = (english[2] ?? english[4]).toLowerCase();
    const index = names.findIndex((n) => n === name || n.slice(0, 3) === name.toLowerCase());
    if (index < 0) return null;
    year = Number(english[3] ?? english[6]);
    month = index + 1;
    day = Number(english[1] ?? english[5]);
  }
  if (year < 2005 || year > new Date().getUTCFullYear() + 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Relative labels are displayed verbatim, never converted into invented timestamps. */
export function verifiedRelativeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (/^(?:today|yesterday|\d{1,3}\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|\d{1,3}\s*[mhdwy]\s*(?:ago)?)$/i.test(text)) {
    return text;
  }
  return null;
}

/** Preserve month/day labels when the platform omits the year. */
export function verifiedDateLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  const numeric = text.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? text : null;
  }
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  const monthFirst = text.match(/^([a-z]+)\.?\s+(\d{1,2})$/i);
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]+)\.?$/i);
  const monthText = monthFirst?.[1] ?? dayFirst?.[2];
  const day = Number(monthFirst?.[2] ?? dayFirst?.[1]);
  if (!monthText || !Number.isInteger(day)) return null;
  const monthIndex = months.findIndex((month) =>
    monthText.toLowerCase() === month || monthText.toLowerCase() === month.slice(0, 3));
  if (monthIndex < 0) return null;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex];
  return day >= 1 && day <= daysInMonth ? text : null;
}

/** Treat a manually read label as its stated precision, never as an invented instant. */
export function parseUserDate(value: string): VideoMetadata | null {
  const input = value.trim();
  const timestamp = verifiedTimestamp(input);
  if (timestamp) return { published_at: timestamp, date_source: 'manual' };
  const day = verifiedCalendarDate(input);
  if (day) return { published_date: day, date_source: 'manual' };
  const label = verifiedDateLabel(input);
  if (label) return { published_label: label, date_source: 'manual' };
  const relative = verifiedRelativeDate(input);
  if (relative) return { published_relative: relative, date_source: 'manual' };
  return null;
}

export function datePrecision(meta: VideoMetadata): DatePrecision {
  if (verifiedTimestamp(meta.published_at)) return 'timestamp';
  if (verifiedCalendarDate(meta.published_date)) return 'day';
  if (verifiedDateLabel(meta.published_label)) return 'month_day';
  if (verifiedRelativeDate(meta.published_relative)) return 'relative';
  return null;
}

export function localDate(iso: string | null, dateOnly: string | null = null, relative: string | null = null, label: string | null = null): { short: string; full: string } {
  if (iso && verifiedTimestamp(iso)) {
    const date = new Date(iso);
    return {
      short: new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date),
      full: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(date),
    };
  }
  const day = verifiedCalendarDate(dateOnly);
  if (day) {
    // A calendar date has no timezone. Format in UTC to avoid shifting its day.
    const short = new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
    return { short, full: `Published date: ${short}. Exact publication time unavailable.` };
  }
  const dateLabel = verifiedDateLabel(label);
  if (dateLabel) return { short: dateLabel, full: `Date shown by the platform: ${dateLabel}. Year and exact publication time unavailable.` };
  const relativeLabel = verifiedRelativeDate(relative);
  if (relativeLabel) return { short: `~${relativeLabel}`, full: `Approximate publication date shown by the platform: ${relativeLabel}. Exact date and time unavailable.` };
  return { short: 'Date unavailable', full: 'Exact publication date and time unavailable' };
}

export function parseMetric(input: unknown): { value: Metric; exact: boolean | null } {
  if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) {
    return { value: input, exact: true };
  }
  if (typeof input !== 'string') return { value: null, exact: null };
  let text = input.trim().replace(/\u00a0/g, ' ');
  text = text.replace(/\s*(?:views?|plays?|lượt xem|likes?|comments?)\s*$/i, '').trim();
  if (/^\d{1,3}(?:,\d{3})+$/.test(text) || /^\d+$/.test(text)) {
    const num = Number(text.replace(/,/g, ''));
    if (Number.isSafeInteger(num)) return { value: num, exact: true };
  }
  if (/^\d+(?:[.,]\d+)?\s*[KMB]$/i.test(text)) {
    return { value: text.replace(/\s/g, '').toUpperCase(), exact: false };
  }
  return { value: null, exact: null };
}

function cleanCaption(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}

function metricFields(out: VideoMetadata, name: 'views' | 'likes' | 'comments', value: unknown) {
  const metric = parseMetric(value);
  if (metric.value === null) return;
  if (out[name] !== null && out[name] !== undefined && out[`${name}_exact`] === true && !metric.exact) return;
  out[name] = metric.value;
  out[`${name}_exact`] = metric.exact;
}

/** Merge only verifiable, nonempty fields. Never lose exact counts to abbreviated labels. */
export function mergeMetadata(...parts: VideoMetadata[]): VideoMetadata {
  const out: VideoMetadata = {};
  for (const part of parts) {
    const timestamp = verifiedTimestamp(part.published_at);
    const day = verifiedCalendarDate(part.published_date);
    const relative = verifiedRelativeDate(part.published_relative);
    const dateLabel = verifiedDateLabel(part.published_label);
    if (part.date_source === 'manual' && (timestamp || day || relative || dateLabel)) {
      // An explicit user correction replaces prior publication-date evidence.
      delete out.published_at;
      delete out.published_date;
      delete out.published_relative;
      delete out.published_label;
      delete out.date_source;
    }
    if (timestamp) {
      if (part.date_source) out.date_source = part.date_source;
      else if (out.published_at !== timestamp) delete out.date_source;
      out.published_at = timestamp;
    } else if (day && !out.published_at) {
      if (part.date_source) out.date_source = part.date_source;
      else if (out.published_date !== day) delete out.date_source;
    } else if (relative && !out.published_at && !out.published_date && !out.published_label) {
      if (part.date_source) out.date_source = part.date_source;
    }
    if (dateLabel && !out.published_at && !out.published_date) {
      if (part.date_source) out.date_source = part.date_source;
      else if (out.published_label !== dateLabel) delete out.date_source;
    }
    if (day) out.published_date = day;
    if (relative) out.published_relative = relative;
    if (dateLabel) out.published_label = dateLabel;
    if (part.caption) out.caption = cleanCaption(part.caption);
    for (const name of ['views', 'likes', 'comments'] as const) {
      if (part[name] !== null && part[name] !== undefined) {
        if (out[`${name}_exact`] === true && part[`${name}_exact`] !== true) continue;
        if (name === 'views') {
          if (part.views_source) out.views_source = part.views_source;
          else if (out.views !== part.views) delete out.views_source;
        }
        out[name] = part[name];
        out[`${name}_exact`] = part[`${name}_exact`] ?? null;
      }
    }
  }
  return out;
}

function withSource(data: VideoMetadata, source: MetadataSource): VideoMetadata {
  if (datePrecision(data)) data.date_source = source;
  if (data.views !== null && data.views !== undefined) data.views_source = source;
  return data;
}

function extractItem(item: Record<string, unknown>, platform: Platform): VideoMetadata {
  const out: VideoMetadata = {};
  const fields = platform === 'Instagram'
    ? ['taken_at_timestamp', 'taken_at', 'taken_at_date', 'published_at', 'datePublished', 'uploadDate']
    : platform === 'TikTok'
      ? ['createTime', 'create_time', 'createTimeISO', 'datePublished', 'uploadDate']
      : ['publish_time', 'creation_time', 'created_time', 'publish_date', 'datePublished', 'uploadDate'];
  for (const key of fields) {
    const parsed = verifiedTimestamp(item[key]);
    if (parsed) { out.published_at = parsed; break; }
  }
  for (const key of fields) {
    const day = verifiedCalendarDate(item[key]);
    if (day) { out.published_date = day; break; }
  }
  for (const key of ['createTimeText', 'relativeTime', 'publishTimeText']) {
    const label = verifiedRelativeDate(item[key]);
    if (label) { out.published_relative = label; break; }
  }
  for (const key of ['desc', 'caption', 'description', 'title', 'accessibility_caption']) {
    const caption = cleanCaption(item[key]);
    if (caption) { out.caption = caption; break; }
  }
  const stats = [item.statsV2, item.stats, item.statistics, item].filter(
    (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value),
  );
  for (const state of stats) {
    for (const name of ['playCount', 'play_count', 'view_count', 'video_view_count', 'views'] as const) {
      if (state[name] !== undefined) { metricFields(out, 'views', state[name]); break; }
    }
    for (const name of ['diggCount', 'like_count', 'likeCount', 'likes'] as const) {
      if (state[name] !== undefined) { metricFields(out, 'likes', state[name]); break; }
    }
    for (const name of ['commentCount', 'comment_count', 'comments'] as const) {
      if (state[name] !== undefined) { metricFields(out, 'comments', state[name]); break; }
    }
  }
  return out;
}

/** Search structured platform hydration state for an ID-matching video, never a neighboring item. */
export function metadataFromStructuredData(data: unknown, id: string, platform: Platform): VideoMetadata {
  const parts: VideoMetadata[] = [];
  const stack: unknown[] = [data];
  const seen = new Set<object>();
  let visited = 0;
  while (stack.length && visited++ < 45_000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) if (typeof child === 'object') stack.push(child); continue; }
    const node = value as Record<string, unknown>;
    const ids = [node.id, node.videoId, node.video_id, node.shortcode, node.code, node.pk, node.media_id];
    if (ids.some((n) => typeof n === 'string' || typeof n === 'number' ? String(n) === id : false)) {
      parts.push(extractItem(node, platform));
    }
    if (platform === 'Facebook' && node.creation_time !== undefined && facebookStoryMatchesVideo(node, id)) {
      parts.push(extractItem(node, platform));
    }
    for (const [key, child] of Object.entries(node)) {
      // TikTok and some Instagram hydration maps use the video ID as the key.
      if (key === id && child && typeof child === 'object' && !Array.isArray(child)) {
        parts.push(extractItem(child as Record<string, unknown>, platform));
      }
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return mergeMetadata(...parts);
}

export function metadataFromScriptTexts(
  texts: string[], id: string, platform: Platform, parsedCache?: Map<string, unknown>,
): VideoMetadata {
  let found: VideoMetadata = {};
  const matches = texts.filter((text) => text.includes(id) && text.length <= 2_000_000);
  const hasDateField = /"(?:taken_at_timestamp|taken_at|published_at|datePublished|uploadDate|createTime|create_time|publish_time|creation_time|created_time)"\s*:/;
  const priority = matches.filter((text) => hasDateField.test(text));
  const remainder = matches.filter((text) => !hasDateField.test(text));
  for (const text of [...priority, ...remainder].slice(0, 100)) {
    try {
      const raw = text.replace(/^for\s*\(;;\)\s*;?\s*/, '');
      let data: unknown;
      if (parsedCache?.has(raw)) data = parsedCache.get(raw);
      else {
        data = JSON.parse(raw);
        parsedCache?.set(raw, data);
      }
      found = mergeMetadata(found, metadataFromStructuredData(data, id, platform));
      if (found.published_at && found.views !== undefined && found.views !== null) break;
    } catch { /* invalid JSON, skip */ }
  }
  return withSource(found, 'embedded');
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/gi, (entity) => {
    const lookup: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'" };
    return lookup[entity.toLowerCase()] ?? entity;
  });
}

function readHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function jsonLdMatchesVideo(item: Record<string, unknown>, id: string, platform: Platform): boolean {
  for (const field of ['identifier', 'videoId', 'video_id', 'id']) {
    const value = item[field];
    if ((typeof value === 'string' || typeof value === 'number') && String(value) === id) return true;
  }
  for (const field of ['url', '@id', 'mainEntityOfPage', 'embedUrl']) {
    const url = item[field];
    if (typeof url === 'string' && identityFromUrl(url, platform)?.id === id) return true;
  }
  return false;
}

function facebookStoryMatchesVideo(story: Record<string, unknown>, id: string): boolean {
  // Facebook sometimes identifies a creation story using an encoded VK reel ID.
  const storyId = story.id ?? story.story_id;
  if (typeof storyId === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(storyId)) {
    try {
      if (new RegExp(`(?:^|:)VK:${id}(?:$|:)`).test(atob(storyId))) return true;
    } catch { /* invalid or non-text story identifier */ }
  }
  for (const key of ['permalink_url', 'url']) {
    if (typeof story[key] === 'string' && identityFromUrl(story[key], 'Facebook')?.id === id) return true;
  }
  const directVideo = story.video;
  if (directVideo && typeof directVideo === 'object' && !Array.isArray(directVideo) &&
    String((directVideo as Record<string, unknown>).id ?? '') === id) return true;
  const shortForm = story.short_form_video_context;
  if (shortForm && typeof shortForm === 'object' && !Array.isArray(shortForm)) {
    const context = shortForm as Record<string, unknown>;
    for (const key of ['playback_video', 'video']) {
      const video = context[key];
      if (video && typeof video === 'object' && !Array.isArray(video) &&
        String((video as Record<string, unknown>).id ?? '') === id) return true;
    }
  }
  if (Array.isArray(story.attachments)) {
    return story.attachments.some((attachment) => {
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false;
      const media = (attachment as Record<string, unknown>).media;
      return !!media && typeof media === 'object' && !Array.isArray(media) &&
        String((media as Record<string, unknown>).id ?? '') === id;
    });
  }
  return false;
}

function instagramPostTimestamp(html: string, id: string): string | null {
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = readHtmlAttributes(anchor[1]).href;
    if (!href) continue;
    let identity;
    try { identity = identityFromUrl(new URL(href, 'https://www.instagram.com/').href, 'Instagram'); }
    catch { continue; }
    if (identity?.id !== id) continue;
    for (const time of anchor[2].matchAll(/<time\b([^>]*)>/gi)) {
      const parsed = verifiedTimestamp(readHtmlAttributes(time[1]).datetime);
      if (parsed) return parsed;
    }
  }
  return null;
}

function tiktokDateFromVideoHtml(html: string): VideoMetadata {
  for (const match of html.matchAll(/<(time|span)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = readHtmlAttributes(match[2]);
    const marker = `${attrs['data-e2e'] ?? ''} ${attrs['data-testid'] ?? ''}`;
    if (tag !== 'time' && !/(?:create.?time|video.?time|publish|date)/i.test(marker)) continue;
    const text = decodeEntities(match[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    const raw = attrs.datetime ?? text;
    const timestamp = verifiedTimestamp(raw);
    if (timestamp) return { published_at: timestamp };
    const day = verifiedCalendarDate(raw);
    if (day) return { published_date: day };
    const relative = verifiedRelativeDate(raw);
    if (relative) return { published_relative: relative };
    const label = verifiedDateLabel(raw);
    if (label) return { published_label: label };
  }
  return {};
}

/** For a fetched *single video page*: meta tags and JSON-LD refer to that video. */
export function metadataFromVideoHtml(html: string, id: string, platform: Platform): VideoMetadata {
  const out: VideoMetadata[] = [];
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = readHtmlAttributes(tag);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    if (key && attrs.content) meta[key] = attrs.content;
  }
  const part: VideoMetadata = {};
  for (const key of ['article:published_time', 'video:release_date', 'datepublished', 'uploaddate', 'publish_date']) {
    const iso = verifiedTimestamp(meta[key]);
    if (iso) { part.published_at = iso; break; }
  }
  for (const key of ['article:published_time', 'video:release_date', 'datepublished', 'uploaddate', 'publish_date']) {
    const day = verifiedCalendarDate(meta[key]);
    if (day) { part.published_date = day; break; }
  }
  part.caption = cleanCaption(meta['og:description'] ?? meta.description);
  for (const key of ['video:view_count', 'interactioncount']) if (meta[key]) metricFields(part, 'views', meta[key]);
  if (platform === 'Instagram' && !part.published_at) {
    // Scope <time> to the permalink for this Reel. Comment timestamps can
    // share the post's displayed calendar date and must never be borrowed.
    part.published_at = instagramPostTimestamp(html, id) ?? undefined;
  }
  if (platform === 'TikTok' && !part.published_at && !part.published_date) {
    Object.assign(part, tiktokDateFromVideoHtml(html));
  }
  out.push(part);

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = readHtmlAttributes(match[1]);
    const text = match[2].trim();
    if (text.length > 2_000_000) continue;
    if (attrs.type === 'application/ld+json') {
      try {
        const data: unknown = JSON.parse(text);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const obj = item as Record<string, unknown>;
          if (obj['@type'] !== 'VideoObject' && !(Array.isArray(obj['@type']) && obj['@type'].includes('VideoObject'))) continue;
          // JSON-LD can mention suggested videos, so require an explicit match.
          if (!jsonLdMatchesVideo(obj, id, platform)) continue;
          const date = verifiedTimestamp(obj.uploadDate ?? obj.datePublished);
          const day = verifiedCalendarDate(obj.uploadDate ?? obj.datePublished);
          if (date || day) out.push({
            published_at: date, published_date: day, caption: cleanCaption(obj.description),
          });
        }
      } catch { /* invalid JSON-LD */ }
    } else if ((attrs.id && /SIGI_STATE|NEXT_DATA|UNIVERSAL_DATA_FOR_REHYDRATION/i.test(attrs.id)) || attrs.type === 'application/json') {
      if (text.includes(id)) {
        try { out.push(metadataFromStructuredData(JSON.parse(text), id, platform)); } catch { /* ignore */ }
      }
    }
  }
  return withSource(mergeMetadata(...out), 'video_page');
}

export function metadataFromTile(anchor: HTMLElement, platform?: Platform): VideoMetadata {
  const out: VideoMetadata = {};
  for (const element of anchor.querySelectorAll('time, span, [data-published-at], [data-create-time], [data-e2e*="time"], [data-e2e*="date"], [data-testid*="publish"], [data-testid*="date"], [title*="ago" i]')) {
    const el = element as HTMLElement;
    const raw = el.getAttribute('datetime') ?? el.dataset.publishedAt ?? el.dataset.createTime ??
      (el.getAttribute('title') && verifiedRelativeDate(el.getAttribute('title')) ? el.getAttribute('title') : el.textContent?.trim());
    const iso = verifiedTimestamp(raw);
    if (iso) { out.published_at = iso; break; }
    const day = verifiedCalendarDate(raw);
    if (day) out.published_date = day;
    const relative = verifiedRelativeDate(raw);
    if (relative) out.published_relative = relative;
    const dateLabel = verifiedDateLabel(raw);
    if (dateLabel) out.published_label = dateLabel;
  }
  const caption = anchor.getAttribute('title') ?? anchor.querySelector('img[alt]')?.getAttribute('alt');
  if (caption && caption.length > 3) out.caption = cleanCaption(caption);
  for (const el of anchor.querySelectorAll('[data-e2e="video-views"], [aria-label], [title]')) {
    const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
    if (!/\b(?:views?|plays?)\b|lượt xem/i.test(label) && el.getAttribute('data-e2e') !== 'video-views') continue;
    let raw = el.getAttribute('data-e2e') === 'video-views' ? el.textContent ?? '' : label;
    // Some Reel thumbnails display the view icon's label separately from its number.
    if (!/\d/.test(raw)) {
      const parentText = el.parentElement?.textContent?.trim() ?? '';
      if (parentText.length < 20) raw = parentText;
    }
    const match = raw.match(/\d[\d,.]*\s*[KMB]?/i);
    if (match) metricFields(out, 'views', match[0]);
  }
  if (platform === 'Instagram' && (out.views === undefined || out.views === null)) {
    for (const icon of anchor.querySelectorAll('[aria-label*="view" i], [title*="view" i]')) {
      const label = icon.getAttribute('aria-label') ?? icon.getAttribute('title') ?? '';
      if (!/view\s*count|views?/i.test(label)) continue;
      for (const container of [icon.parentElement, icon.parentElement?.parentElement]) {
        if (!container) continue;
        // SVG <title> text is included in textContent on some Instagram tiles.
        // Read compact count siblings independently of accessibility text.
        for (const child of container.childNodes) {
          if (child instanceof Element && (child === icon || child.tagName.toLowerCase() === 'svg' || child.contains(icon))) continue;
          const metric = parseMetric(child.textContent?.trim() ?? '');
          if (metric.value === null) continue;
          out.views = metric.value;
          out.views_exact = metric.exact;
          break;
        }
        if (out.views !== undefined) break;
      }
      if (out.views !== undefined) break;
    }
  }
  if (platform === 'Instagram' && (out.views === undefined || out.views === null)) {
    // Reel tiles commonly render a play glyph beside an unlabeled view count.
    // Only read a compact glyph-and-count element, avoiding likes and captions.
    for (const icon of anchor.querySelectorAll('svg[aria-label*="play" i], svg[aria-label*="view" i], svg:has(polygon), [data-testid*="play" i]')) {
      if (icon.closest('[data-track-view-media]')) continue;
      for (const element of [icon.parentElement, icon.parentElement?.parentElement]) {
        const text = element?.textContent?.trim() ?? '';
        if (!/^\d[\d,.]*\s*[KMB]?$/i.test(text)) continue;
        const metric = parseMetric(text);
        if (metric.value === null) continue;
        out.views = metric.value;
        out.views_exact = metric.exact;
        break;
      }
      if (out.views !== undefined) break;
    }
  }
  return withSource(out, 'tile');
}
