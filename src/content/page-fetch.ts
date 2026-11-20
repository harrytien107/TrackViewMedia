import { datePrecision, metadataFromVideoHtml } from '../shared/metadata';
import { contextFromUrl, identityFromUrl } from '../shared/urls';
import type { PageFetchRequest, PageFetchResponse } from '../shared/types';

export async function fetchVideoFromPage(request: PageFetchRequest): Promise<PageFetchResponse> {
  const context = contextFromUrl(location.href);
  const identity = identityFromUrl(request.url, request.platform);
  if (!context || context.platform !== request.platform || !identity || identity.id !== request.id) {
    return { metadata: null, diagnostic: 'invalid_video_request' };
  }

  const target = new URL(request.url);
  const origin = new URL(location.href);
  // Use this document's origin so session cookies are sent as first-party cookies.
  const url = new URL(target.pathname + target.search, origin.origin);
  if (identityFromUrl(url.href, request.platform)?.id !== request.id) {
    return { metadata: null, diagnostic: 'video_origin_mismatch' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.href, {
      credentials: 'same-origin', redirect: 'follow', signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return { metadata: null, diagnostic: `http_${response.status}` };
    if (identityFromUrl(response.url, request.platform)?.id !== request.id) {
      return { metadata: null, diagnostic: 'redirected_to_other_page' };
    }
    if (!response.headers.get('content-type')?.includes('text/html')) {
      return { metadata: null, diagnostic: 'non_html_response' };
    }
    if (Number(response.headers.get('content-length') ?? 0) >= 4_000_000) {
      return { metadata: null, diagnostic: 'page_too_large' };
    }
    const html = await response.text();
    if (html.length >= 4_000_000) return { metadata: null, diagnostic: 'page_too_large' };

    const ogUrl = html.match(/<meta\s+[^>]*property=["']og:url["'][^>]*>/i)?.[0];
    const ogHref = ogUrl?.match(/content=["']([^"']+)["']/i)?.[1];
    if (ogHref && identityFromUrl(ogHref.replace(/&amp;/g, '&'), request.platform)?.id !== request.id) {
      return { metadata: null, diagnostic: 'page_identity_mismatch' };
    }
    const metadata = metadataFromVideoHtml(html, request.id, request.platform);
    return {
      metadata: Object.keys(metadata).length ? metadata : null,
      diagnostic: datePrecision(metadata) ? 'matched_video_date' : 'no_video_date',
    };
  } catch (error) {
    return { metadata: null, diagnostic: error instanceof Error && error.name === 'AbortError'
      ? 'request_timeout' : 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}
