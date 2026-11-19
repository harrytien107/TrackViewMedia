import { describe, expect, it } from 'vitest';
import { contextFromUrl, identityFromUrl } from './urls';

describe('supported pages', () => {
  it('recognizes the three supplied profile examples', () => {
    expect(contextFromUrl('https://www.instagram.com/ssam_kbbq/reels/')).toEqual({
      platform: 'Instagram', username: 'ssam_kbbq', kind: 'profile',
    });
    expect(contextFromUrl('https://www.tiktok.com/@tungthitsizzlingsteak')).toEqual({
      platform: 'TikTok', username: 'tungthitsizzlingsteak', kind: 'profile',
    });
    expect(contextFromUrl('https://www.facebook.com/profile.php?id=61574788228123&sk=reels_tab')).toEqual({
      platform: 'Facebook', username: '61574788228123', kind: 'profile',
    });
    expect(contextFromUrl('https://www.facebook.com/people/Ssam-KBBQ-Bar/61574788228123/?sk=reels_tab')).toEqual({
      platform: 'Facebook', username: '61574788228123', kind: 'profile',
    });
  });

  it('keeps video IDs as strings and removes tracking parameters', () => {
    expect(identityFromUrl('https://www.tiktok.com/@chef/video/007654321?ref=abc', 'TikTok')).toEqual({
      id: '007654321', url: 'https://www.tiktok.com/@chef/video/007654321', username: 'chef',
    });
    expect(identityFromUrl('https://www.instagram.com/reel/ABC-def_012/?igsh=bad', 'Instagram')?.id).toBe('ABC-def_012');
    expect(identityFromUrl('https://www.instagram.com/ssam_kbbq/reel/DFHmVC0zHkj/', 'Instagram')).toEqual({
      id: 'DFHmVC0zHkj', url: 'https://www.instagram.com/reel/DFHmVC0zHkj/', username: 'ssam_kbbq',
    });
    expect(identityFromUrl('https://www.facebook.com/watch/?v=123456789&tracking=1', 'Facebook')?.url)
      .toBe('https://www.facebook.com/reel/123456789');
    expect(identityFromUrl('https://www.facebook.com/61574788228123/videos/rice-lovers-and-food/1130192402541878/', 'Facebook')?.id)
      .toBe('1130192402541878');
  });

  it('rejects third-party, unsupported, and non-video URLs', () => {
    expect(identityFromUrl('https://tiktok.com.evil.example/@chef/video/123', 'TikTok')).toBeNull();
    expect(identityFromUrl('http://www.tiktok.com/@chef/video/123', 'TikTok')).toBeNull();
    expect(identityFromUrl('https://www.instagram.com/chef/', 'Instagram')).toBeNull();
    expect(contextFromUrl('https://www.instagram.com/explore/')).toBeNull();
    expect(identityFromUrl('https://www.instagram.com/reel/%E0%A4/', 'Instagram')).toBeNull();
    expect(contextFromUrl('https://www.facebook.com/')).toBeNull();
  });
});
