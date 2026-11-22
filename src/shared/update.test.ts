import { describe, expect, it } from 'vitest';
import { isNewerVersion, releaseInfoFromGithub } from './update';

describe('GitHub update helpers', () => {
  it('compares normal extension versions', () => {
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.2.1', '0.2.0')).toBe(false);
    expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
  });

  it('accepts the expected GitHub release shape', () => {
    expect(releaseInfoFromGithub({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/harrytien107/TrackViewMedia/releases/tag/v0.2.0',
    })).toEqual({
      version: '0.2.0',
      url: 'https://github.com/harrytien107/TrackViewMedia/releases/tag/v0.2.0',
    });
  });

  it('rejects malformed or unrelated release URLs', () => {
    expect(releaseInfoFromGithub({ tag_name: 'latest', html_url: 'https://github.com/example/repo/releases/latest' })).toBeNull();
    expect(releaseInfoFromGithub({ tag_name: 'v0.2.0', html_url: 'https://example.com/v0.2.0' })).toBeNull();
  });
});
