import type { VideoMetadata, VideoRecord } from './types';
import { datePrecision, mergeMetadata } from './metadata';

export const SELECTED_PREFIX = 'selected:';
export const selectionKey = (record: Pick<VideoRecord, 'platform' | 'video_id'>) =>
  `${SELECTED_PREFIX}${record.platform}:${record.video_id}`;

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
    ['Instagram', 'TikTok', 'Facebook'].includes(record.platform ?? '');
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

export async function updateSelectedMetadata(record: VideoRecord, extra: VideoMetadata): Promise<void> {
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
