import type { VideoRecord } from './types';

export const EXPORT_FIELDS: (keyof VideoRecord)[] = [
  'platform', 'username', 'video_id', 'video_url', 'caption', 'published_at', 'published_date', 'published_label',
  'views', 'views_exact', 'likes', 'likes_exact', 'comments', 'comments_exact', 'collected_at',
  'published_relative', 'date_precision', 'date_source', 'views_source',
];

// Prefix spreadsheet formulas in untrusted text to prevent CSV formula execution.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(records: VideoRecord[]): string {
  return '\ufeff' + [
    EXPORT_FIELDS.join(','),
    ...records.map((record) => EXPORT_FIELDS.map((field) => csvCell(record[field])).join(',')),
  ].join('\r\n');
}

export function toJson(records: VideoRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function exportFilename(ext: 'csv' | 'json'): string {
  return `TrackViewMedia-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
}
