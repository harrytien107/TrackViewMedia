import type { Platform, VideoMetadata, VideoRecord } from './types';
import { datePrecision, mergeMetadata } from './metadata';

export const SELECTED_PREFIX = 'selected:';
export const VERIFIED_PREFIX = 'verified:';
const VERIFIED_CACHE_LIMIT = 500;
const VERIFIED_CACHED_AT = '__cached_at';
export const selectionKey = (record: Pick<VideoRecord, 'platform' | 'video_id'>) =>
  `${SELECTED_PREFIX}${record.platform}:${record.video_id}`;
export const verifiedKey = (record: Pick<VideoRecord, 'platform' | 'video_id'>) =>
  `${VERIFIED_PREFIX}${record.platform}:${record.video_id}`;

type StoredVerifiedMetadata = VideoMetadata & { [VERIFIED_CACHED_AT]?: number };

function compactVerifiedMetadata(metadata: VideoMetadata): VideoMetadata {
  const { published_at, published_date, published_relative, published_label, date_source } = metadata;
  return mergeMetadata({ published_at, published_date, published_relative, published_label, date_source });
}

function withoutCacheTimestamp(value: StoredVerifiedMetadata): VideoMetadata {
  const { [VERIFIED_CACHED_AT]: _cachedAt, ...metadata } = value;
  return compactVerifiedMetadata(metadata);
}

export async function allVerifiedMetadata(): Promise<Map<string, VideoMetadata>> {
  const entries = await chrome.storage.local.get(null);
  const verified = new Map<string, VideoMetadata>();
  const stored: Array<{ key: string; value: StoredVerifiedMetadata; cachedAt: number; selected: boolean }> = [];
  for (const [key, value] of Object.entries(entries)) {
    if (key.startsWith(VERIFIED_PREFIX) && value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as StoredVerifiedMetadata;
      stored.push({
        key, value: item,
        cachedAt: typeof item[VERIFIED_CACHED_AT] === 'number' ? item[VERIFIED_CACHED_AT]! : 0,
        selected: Object.prototype.hasOwnProperty.call(entries, `${SELECTED_PREFIX}${key.slice(VERIFIED_PREFIX.length)}`),
      });
    }
  }
  const removable = stored.filter((item) => !item.selected)
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(VERIFIED_CACHE_LIMIT);
  if (removable.length) await chrome.storage.local.remove(removable.map((item) => item.key));
  const removed = new Set(removable.map((item) => item.key));
  const replacements: Record<string, StoredVerifiedMetadata> = {};
  for (const item of stored) {
    if (removed.has(item.key)) continue;
    const compact = withoutCacheTimestamp(item.value);
    if (!datePrecision(compact)) {
      await chrome.storage.local.remove(item.key);
      continue;
    }
    verified.set(item.key, compact);
    const cachedAt = item.cachedAt || Date.now();
    const replacement = { ...compact, [VERIFIED_CACHED_AT]: cachedAt };
    if (JSON.stringify(replacement) !== JSON.stringify(item.value)) replacements[item.key] = replacement;
  }
  if (Object.keys(replacements).length) await chrome.storage.local.set(replacements);
  return verified;
}

export async function getVerifiedMetadata(platform: Platform, video_id: string): Promise<VideoMetadata> {
  const key = verifiedKey({ platform, video_id });
  const value = (await chrome.storage.local.get(key))[key] as StoredVerifiedMetadata | undefined;
  return value ? withoutCacheTimestamp(value) : {};
}

export async function saveVerifiedMetadata(
  record: Pick<VideoRecord, 'platform' | 'video_id'>, metadata: VideoMetadata,
): Promise<void> {
  const prior = await getVerifiedMetadata(record.platform, record.video_id);
  const next = metadata.date_source === 'manual'
    ? mergeMetadata(prior, metadata)
    : mergeMetadata(prior, metadata, prior.date_source === 'manual' ? prior : {});
  await updateSelectedMetadata(record, next);
  const compact = compactVerifiedMetadata(next);
  const key = verifiedKey(record);
  if (datePrecision(compact)) {
    await chrome.storage.local.set({ [key]: { ...compact, [VERIFIED_CACHED_AT]: Date.now() } satisfies StoredVerifiedMetadata });
  } else {
    await chrome.storage.local.remove(key);
  }
}

export async function allSelections(): Promise<VideoRecord[]> {
  const entries = await chrome.storage.local.get(null);
  return Object.entries(entries)
    .filter(([key, value]) => key.startsWith(SELECTED_PREFIX) && isRecord(value))
    .map(([, record]) => record as VideoRecord)
    .sort((a, b) => a.collected_at.localeCompare(b.collected_at));
}

function isRecord(value: unknown): value is VideoRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<VideoRecord>;
  return !!record.video_id && !!record.video_url &&
    ['Instagram', 'TikTok', 'Facebook', 'YouTube'].includes(record.platform ?? '');
}

export async function saveSelection(record: VideoRecord): Promise<void> {
  await chrome.storage.local.set({ [selectionKey(record)]: record });
}

export async function removeSelection(record: Pick<VideoRecord, 'platform' | 'video_id'>): Promise<void> {
  await chrome.storage.local.remove(selectionKey(record));
}

export async function clearSelections(): Promise<void> {
  const entries = await chrome.storage.local.get(null);
  const keys = Object.keys(entries).filter((key) => key.startsWith(SELECTED_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function updateSelectedMetadata(
  record: Pick<VideoRecord, 'platform' | 'video_id'>, extra: VideoMetadata,
): Promise<void> {
  const key = selectionKey(record);
  const existing = (await chrome.storage.local.get(key))[key] as VideoRecord | undefined;
  if (!existing) return;
  const { caption, published_at, published_date, published_relative, published_label, date_source, views_source, views, views_exact, likes, likes_exact, comments, comments_exact } =
    mergeMetadata(existing, extra);
  await chrome.storage.local.set({ [key]: {
    ...existing, caption: caption ?? null, published_at: published_at ?? null,
    published_date: published_date ?? null, published_relative: published_relative ?? null,
    published_label: published_label ?? null,
    date_precision: datePrecision({ published_at, published_date, published_relative, published_label }),
    date_source: date_source ?? null, views_source: views_source ?? null,
    views: views ?? null, views_exact: views_exact ?? null,
    likes: likes ?? null, likes_exact: likes_exact ?? null,
    comments: comments ?? null, comments_exact: comments_exact ?? null,
  } satisfies VideoRecord });
}
