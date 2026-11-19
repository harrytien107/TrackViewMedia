import type { PageContext, Platform, VideoIdentity } from './types';

const hostMap: Record<Platform, RegExp> = {
  Instagram: /^(?:www\.)?instagram\.com$/i,
  TikTok: /^(?:www\.|m\.)?tiktok\.com$/i,
  Facebook: /^(?:www\.|m\.|web\.)?facebook\.com$/i,
};

export function platformForUrl(url: URL): Platform | null {
  return (Object.keys(hostMap) as Platform[]).find((p) => hostMap[p].test(url.hostname)) ?? null;
}

export function identityFromUrl(raw: string, platform: Platform): VideoIdentity | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || !hostMap[platform].test(url.hostname)) return null;
  let path: string;
  try { path = decodeURI(url.pathname); } catch { return null; }
  let id: string | undefined;
  let username: string | null = null;
  let canonical: string;

  if (platform === 'Instagram') {
    // Public profile grids also use /<username>/reel/<shortcode>/ links.
    const onProfile = path.match(/^\/([\w.]+)\/reel\/([\w-]+)\/?$/i);
    const match = path.match(/^\/(reel|p|tv)\/([\w-]+)\/?$/i);
    if (!match && !onProfile) return null;
    if (onProfile) username = onProfile[1];
    id = (onProfile ?? match)![2];
    canonical = `https://www.instagram.com/${onProfile ? 'reel' : match![1].toLowerCase()}/${id}/`;
  } else if (platform === 'TikTok') {
    const match = path.match(/^\/@([\w.]+)\/video\/(\d+)\/?$/i);
    if (!match) return null;
    username = match[1];
    id = match[2];
    canonical = `https://www.tiktok.com/@${username}/video/${id}`;
  } else {
    let match = path.match(/^\/reel\/(\d+)\/?$/i);
    if (!match) match = path.match(/^\/[^/]+\/videos\/(?:[^/]+\/)?(\d+)\/?$/i);
    if (match) {
      id = match[1];
    } else if (/^\/watch\/?$/i.test(path)) {
      const watch = url.searchParams.get('v');
      if (watch && /^\d+$/.test(watch)) id = watch;
    }
    if (!id) return null;
    canonical = `https://www.facebook.com/reel/${id}`;
  }
  return { id, url: canonical, username };
}

const reservedInstagram = new Set([
  'reel', 'reels', 'p', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about',
  'developer', 'privacy', 'legal', 'challenge', 'api', 'threads',
]);

export function contextFromUrl(raw: string): PageContext | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const platform = platformForUrl(url);
  if (!platform || url.protocol !== 'https:') return null;
  let path: string;
  try { path = decodeURI(url.pathname); } catch { return null; }
  if (platform === 'Instagram') {
    const video = identityFromUrl(raw, platform);
    if (video) return { platform, username: video.username ?? '', kind: 'video' };
    const match = path.match(/^\/([\w.]+)(?:\/reels\/?)?\/?$/i);
    if (!match || reservedInstagram.has(match[1].toLowerCase())) return null;
    return { platform, username: match[1], kind: 'profile' };
  }
  if (platform === 'TikTok') {
    const video = identityFromUrl(raw, platform);
    if (video) return { platform, username: video.username ?? '', kind: 'video' };
    const match = path.match(/^\/@([\w.]+)\/?$/i);
    return match ? { platform, username: match[1], kind: 'profile' } : null;
  }
  const video = identityFromUrl(raw, platform);
  if (video) return { platform, username: '', kind: 'video' };
  if (/^\/profile\.php$/i.test(path)) {
    const id = url.searchParams.get('id');
    if (id && /^\d+$/.test(id) && (!url.searchParams.has('sk') || url.searchParams.get('sk') === 'reels_tab')) {
      return { platform, username: id, kind: 'profile' };
    }
  }
  // Facebook redirects some profile.php IDs to /people/<slug>/<id>/?sk=reels_tab.
  const person = path.match(/^\/people\/[^/]+\/(\d+)\/?$/i);
  if (person && url.searchParams.get('sk') === 'reels_tab') {
    return { platform, username: person[1], kind: 'profile' };
  }
  const named = path.match(/^\/([\w.\-]+)\/(?:reels|videos)\/?$/i);
  if (named) return { platform, username: named[1], kind: 'profile' };
  return null;
}
