import { identityFromUrl, platformForUrl } from '../shared/urls';
import { datePrecision, mergeMetadata, metadataFromVideoHtml, verifiedCalendarDate, verifiedTimestamp } from '../shared/metadata';
import type { PageFetchRequest, PageFetchResponse, Platform, ResolveRequest, ResolveResponse, VideoMetadata } from '../shared/types';

// A new cache namespace retries missing dates after upgrading the lookup strategy.
const CACHE_PREFIX = 'metadata:v5:';
const RATE_KEY_PREFIX = 'metadata_request_history:';
const POSITIVE_TTL = 7 * 24 * 60 * 60_000;
const PARTIAL_TTL = 10 * 60_000;
const NEGATIVE_TTL = 15 * 60_000;
const MAX_FALLBACK_CACHE_ENTRIES = 120;
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW: Record<Platform, number> = {
  Instagram: 12,
  TikTok: 12,
  Facebook: 30,
  YouTube: 30,
};
const MIN_GAP_MS = 300;
const MAX_CONCURRENT = 3;
let activeWork = 0;
const workWaiters: Array<() => void> = [];
const lastRequest = new Map<Platform, number>();
const rateWork = new Map<Platform, Promise<void>>();
const pending = new Map<string, Promise<ResolveResponse>>();
let fallbackCacheCount = 0;
let fallbackCacheCleanup: Promise<void> | null = null;

type CacheEntry = { timestamp: number; metadata: VideoMetadata | null; diagnostic?: string };

export function cacheLifetime(metadata: VideoMetadata | null): number {
  if (!metadata) return NEGATIVE_TTL;
  if (verifiedTimestamp(metadata.published_at) || verifiedCalendarDate(metadata.published_date)) {
    return POSITIVE_TTL;
  }
  return PARTIAL_TTL;
}

export async function cleanupFallbackCache(now = Date.now()): Promise<number> {
  const entries = await chrome.storage.local.get(null);
  const candidates: Array<{ key: string; timestamp: number; metadata: VideoMetadata | null }> = [];
  const remove = new Set<string>();
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      remove.add(key);
      continue;
    }
    const entry = value as Partial<CacheEntry>;
    if (typeof entry.timestamp !== 'number' || now - entry.timestamp >= cacheLifetime(entry.metadata ?? null)) {
      remove.add(key);
      continue;
    }
    candidates.push({ key, timestamp: entry.timestamp, metadata: entry.metadata ?? null });
  }
  candidates.sort((a, b) => b.timestamp - a.timestamp);
  for (const entry of candidates.slice(MAX_FALLBACK_CACHE_ENTRIES)) remove.add(entry.key);
  if (remove.size) await chrome.storage.local.remove([...remove]);
  return Math.min(candidates.length, MAX_FALLBACK_CACHE_ENTRIES);
}

async function ensureFallbackCacheCleanup(): Promise<void> {
  if (!fallbackCacheCleanup) {
    fallbackCacheCleanup = cleanupFallbackCache().then((count) => { fallbackCacheCount = count; });
  }
  await fallbackCacheCleanup;
}

function validMessage(value: unknown): value is ResolveRequest {
  if (!value || typeof value !== 'object') return false;
  const req = value as Partial<ResolveRequest>;
  if (req.type !== 'resolve-metadata' || typeof req.platform !== 'string' ||
    !['Instagram', 'TikTok', 'Facebook', 'YouTube'].includes(req.platform) ||
    typeof req.id !== 'string' || typeof req.url !== 'string') return false;
  const identity = identityFromUrl(req.url, req.platform);
  return !!identity && identity.id === req.id && identity.url === req.url;
}

async function queue<T>(task: () => Promise<T>): Promise<T> {
  if (activeWork >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => workWaiters.push(resolve));
  }
  activeWork += 1;
  try {
    return await task();
  } finally {
    activeWork -= 1;
    workWaiters.shift()?.();
  }
}

function reserveRequest(platform: Platform): Promise<number | null> {
  const previous = rateWork.get(platform) ?? Promise.resolve();
  const result = previous.then(async () => {
    const key = `${RATE_KEY_PREFIX}${platform}`;
    const now = Date.now();
    const state = await chrome.storage.local.get(key);
    const timestamps: number[] = Array.isArray(state[key])
      ? (state[key] as number[]).filter((time) => now - time < WINDOW_MS && time <= now)
      : [];
    if (timestamps.length >= MAX_PER_WINDOW[platform]) return timestamps[0] + WINDOW_MS + 1000;
    const platformLastRequest = Math.max(lastRequest.get(platform) ?? 0, ...timestamps, 0);
    const delay = Math.max(0, MIN_GAP_MS - (Date.now() - platformLastRequest));
    if (delay) await new Promise((done) => setTimeout(done, delay));
    const reservedAt = Date.now();
    lastRequest.set(platform, reservedAt);
    timestamps.push(reservedAt);
    await chrome.storage.local.set({ [key]: timestamps });
    return null;
  });
  rateWork.set(platform, result.then(() => undefined, () => undefined));
  return result;
}

async function resolveMetadata(req: ResolveRequest, sender: chrome.runtime.MessageSender): Promise<ResolveResponse> {
  await ensureFallbackCacheCleanup();
  const cacheKey = `${CACHE_PREFIX}${req.platform}:${req.id}`;
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey] as CacheEntry | undefined;
  if (cached && Date.now() - cached.timestamp < cacheLifetime(cached.metadata)) {
    return { metadata: cached.metadata, status: 'cached', diagnostic: cached.diagnostic,
      retry_after: cached.timestamp + cacheLifetime(cached.metadata) };
  }
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const promise = queue(async () => {
    let metadata: VideoMetadata | null = null;
    let diagnostic = 'no_matching_metadata';
    let pageLookupHasDate = false;
    let requestReserved = false;
    const pageUrl = sender.url ? new URL(sender.url) : null;
    if (sender.tab?.id !== undefined && pageUrl && platformForUrl(pageUrl) === req.platform) {
      const retryAfter = await reserveRequest(req.platform);
      if (retryAfter !== null) {
        return { metadata: null, status: 'rate_limited' as const, diagnostic: 'request_limit_reached', retry_after: retryAfter };
      }
      requestReserved = true;
      try {
        const request: PageFetchRequest = { type: 'fetch-video-from-page', platform: req.platform, id: req.id, url: req.url };
        const result = await Promise.race([
          chrome.tabs.sendMessage<PageFetchRequest, PageFetchResponse>(sender.tab.id, request),
          new Promise<PageFetchResponse>((_, reject) => setTimeout(() => reject(new Error('tab_timeout')), 9500)),
        ]);
        metadata = result?.metadata ?? null;
        diagnostic = `page:${result?.diagnostic ?? 'no_response'}`;
        pageLookupHasDate = !!metadata && !!datePrecision(metadata);
      } catch {
        diagnostic = 'page:unavailable';
      }
    }

    // Signed-in page HTML can differ from the extension-origin response. If the
    // tab lookup found no date, try the alternate response before caching the
    // record as incomplete. One video resolution consumes one rate-limit slot.
    if (!pageLookupHasDate && (!metadata || !datePrecision(metadata))) {
      if (!requestReserved) {
        const retryAfter = await reserveRequest(req.platform);
        if (retryAfter !== null) {
          return { metadata, status: 'rate_limited' as const, diagnostic: 'request_limit_reached', retry_after: retryAfter };
        }
        requestReserved = true;
      }
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
            const ogUrl = html.match(/<meta\s+[^>]*property=["']og:url["'][^>]*>/i)?.[0];
            const ogHref = ogUrl?.match(/content=["']([^"']+)["']/i)?.[1];
            const ogIdentity = ogHref ? identityFromUrl(ogHref.replace(/&amp;/g, '&'), req.platform) : null;
            if (!ogHref || ogIdentity?.id === req.id) {
              const parsed = metadataFromVideoHtml(html, req.id, req.platform);
              metadata = mergeMetadata(metadata ?? {}, parsed);
              diagnostic = datePrecision(metadata) ? 'matched_video_metadata' : 'no_video_date';
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
      } finally {
        clearTimeout(timeout);
      }
    }
    const timestamp = Date.now();
    await chrome.storage.local.set({ [cacheKey]: { timestamp, metadata, diagnostic } satisfies CacheEntry });
    if (!cached) fallbackCacheCount += 1;
    if (fallbackCacheCount > MAX_FALLBACK_CACHE_ENTRIES) {
      fallbackCacheCount = await cleanupFallbackCache(timestamp);
    }
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

chrome.runtime.onMessage.addListener((message: unknown, sender, respond: (value: ResolveResponse) => void) => {
  if (!validMessage(message)) return false;
  void resolveMetadata(message, sender).then(respond).catch(() => respond({ metadata: null, status: 'unavailable' }));
  return true;
});
