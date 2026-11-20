import { identityFromUrl } from '../shared/urls';
import { metadataFromVideoHtml, verifiedCalendarDate, verifiedTimestamp } from '../shared/metadata';
import type { ResolveRequest, ResolveResponse, VideoMetadata } from '../shared/types';

const CACHE_PREFIX = 'metadata:';
const RATE_KEY = 'metadata_request_history';
const POSITIVE_TTL = 7 * 24 * 60 * 60_000;
const PARTIAL_TTL = 10 * 60_000;
const NEGATIVE_TTL = 15 * 60_000;
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 12;
const MIN_GAP_MS = 2500;
let work = Promise.resolve();
let lastRequest = 0;
const pending = new Map<string, Promise<ResolveResponse>>();

type CacheEntry = { timestamp: number; metadata: VideoMetadata | null; diagnostic?: string };

export function cacheLifetime(metadata: VideoMetadata | null): number {
  if (!metadata) return NEGATIVE_TTL;
  if ((verifiedTimestamp(metadata.published_at) || verifiedCalendarDate(metadata.published_date)) &&
      metadata.views !== undefined && metadata.views !== null) {
    return POSITIVE_TTL;
  }
  return PARTIAL_TTL;
}

function validMessage(value: unknown): value is ResolveRequest {
  if (!value || typeof value !== 'object') return false;
  const req = value as Partial<ResolveRequest>;
  if (req.type !== 'resolve-metadata' || typeof req.platform !== 'string' ||
    !['Instagram', 'TikTok', 'Facebook'].includes(req.platform) ||
    typeof req.id !== 'string' || typeof req.url !== 'string') return false;
  const identity = identityFromUrl(req.url, req.platform);
  return !!identity && identity.id === req.id && identity.url === req.url;
}

function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = work.then(task, task);
  work = next.then(() => undefined, () => undefined);
  return next;
}

async function resolveMetadata(req: ResolveRequest): Promise<ResolveResponse> {
  const cacheKey = `${CACHE_PREFIX}${req.platform}:${req.id}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as CacheEntry | undefined;
  if (cached && Date.now() - cached.timestamp < cacheLifetime(cached.metadata)) {
    return { metadata: cached.metadata, status: 'cached', diagnostic: cached.diagnostic,
      retry_after: cached.timestamp + cacheLifetime(cached.metadata) };
  }
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const promise = queue(async () => {
    const now = Date.now();
    const state = await chrome.storage.local.get(RATE_KEY);
    const timestamps: number[] = Array.isArray(state[RATE_KEY])
      ? (state[RATE_KEY] as number[]).filter((time) => now - time < WINDOW_MS && time <= now)
      : [];
    if (timestamps.length >= MAX_PER_WINDOW) {
      return { metadata: null, status: 'rate_limited' as const, diagnostic: 'request_limit_reached',
        retry_after: timestamps[0] + WINDOW_MS + 1000 };
    }
    if (timestamps.length) lastRequest = Math.max(lastRequest, ...timestamps);
    const delay = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequest));
    if (delay) await new Promise((done) => setTimeout(done, delay));
    lastRequest = Date.now();
    timestamps.push(lastRequest);
    await chrome.storage.local.set({ [RATE_KEY]: timestamps });

    let metadata: VideoMetadata | null = null;
    let diagnostic = 'no_matching_metadata';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(req.url, {
        credentials: 'include', redirect: 'follow', signal: controller.signal,
        headers: { Accept: 'text/html' }, referrerPolicy: 'no-referrer',
      });
      const resolvedIdentity = identityFromUrl(response.url, req.platform);
      if (response.ok && resolvedIdentity?.id === req.id &&
        response.headers.get('content-type')?.includes('text/html') &&
        Number(response.headers.get('content-length') ?? 0) < 4_000_000) {
        const html = await response.text();
        if (html.length < 4_000_000) {
          // Guard against landing on a login/challenge page with unrelated metadata.
          const ogUrl = html.match(/<meta\s+[^>]*property=["']og:url["'][^>]*>/i)?.[0];
          const ogHref = ogUrl?.match(/content=["']([^"']+)["']/i)?.[1];
          const ogIdentity = ogHref ? identityFromUrl(ogHref.replace(/&amp;/g, '&'), req.platform) : null;
          if (!ogHref || ogIdentity?.id === req.id) {
            const parsed = metadataFromVideoHtml(html, req.id, req.platform);
            if (Object.values(parsed).some((v) => v !== null && v !== undefined)) {
              metadata = parsed;
              diagnostic = 'matched_video_metadata';
            }
          } else {
            diagnostic = 'page_identity_mismatch';
          }
        } else {
          diagnostic = 'page_too_large';
        }
      } else if (!response.ok) {
        diagnostic = `http_${response.status}`;
      } else if (resolvedIdentity?.id !== req.id) {
        diagnostic = 'redirected_to_other_page';
      } else if (!response.headers.get('content-type')?.includes('text/html')) {
        diagnostic = 'non_html_response';
      } else {
        diagnostic = 'page_too_large';
      }
    } catch (error) {
      diagnostic = error instanceof Error && error.name === 'AbortError'
        ? 'request_timeout' : 'network_error';
    }
    finally { clearTimeout(timeout); }
    const timestamp = Date.now();
    await chrome.storage.local.set({ [cacheKey]: { timestamp, metadata, diagnostic } satisfies CacheEntry });
    return {
      metadata,
      status: metadata ? 'resolved' as const : 'unavailable' as const,
      diagnostic,
      retry_after: timestamp + cacheLifetime(metadata),
    };
  });
  pending.set(cacheKey, promise);
  try { return await promise; } finally { pending.delete(cacheKey); }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, respond: (value: ResolveResponse) => void) => {
  if (!validMessage(message)) return false;
  void resolveMetadata(message).then(respond).catch(() => respond({ metadata: null, status: 'unavailable' }));
  return true;
});
