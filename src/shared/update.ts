export interface ReleaseInfo {
  version: string;
  url: string;
}

const LATEST_RELEASE_URL = 'https://api.github.com/repos/harrytien107/TrackViewMedia/releases/latest';

function versionParts(version: string): number[] | null {
  const normalized = version.trim().replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) return null;
  return normalized.split('.').map(Number);
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const left = versionParts(current);
  const right = versionParts(candidate);
  if (!left || !right) return false;
  for (let index = 0; index < Math.max(left.length, right.length, 3); index += 1) {
    const currentPart = left[index] ?? 0;
    const candidatePart = right[index] ?? 0;
    if (candidatePart !== currentPart) return candidatePart > currentPart;
  }
  return false;
}

export function releaseInfoFromGithub(value: unknown): ReleaseInfo | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Record<string, unknown>;
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') return null;
  const version = release.tag_name.trim().replace(/^v/i, '');
  if (!versionParts(version) || !release.html_url.startsWith('https://github.com/harrytien107/TrackViewMedia/')) return null;
  return { version, url: release.html_url };
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<ReleaseInfo | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  });
  if (!response.ok) return null;
  return releaseInfoFromGithub(await response.json());
}
