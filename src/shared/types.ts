export type Platform = 'Instagram' | 'TikTok' | 'Facebook';

export type Metric = number | string | null;

export interface VideoRecord {
  platform: Platform;
  username: string;
  video_id: string;
  video_url: string;
  caption: string | null;
  published_at: string | null;
  /** Source-provided calendar day, retained when an exact timestamp is unavailable. */
  published_date: string | null;
  views: Metric;
  views_exact: boolean | null;
  likes: Metric;
  likes_exact: boolean | null;
  comments: Metric;
  comments_exact: boolean | null;
  collected_at: string;
}

export type VideoMetadata = Partial<Pick<VideoRecord,
  'caption' | 'published_at' | 'published_date' | 'views' | 'views_exact' |
  'likes' | 'likes_exact' | 'comments' | 'comments_exact'>>;

export interface PageContext {
  platform: Platform;
  username: string;
  kind: 'profile' | 'video';
}

export interface VideoIdentity {
  id: string;
  url: string;
  username: string | null;
}

export interface Candidate {
  anchor: HTMLAnchorElement;
  tile: HTMLElement;
  identity: VideoIdentity;
  metadata: VideoMetadata;
}

export type ResolveRequest = {
  type: 'resolve-metadata';
  platform: Platform;
  id: string;
  url: string;
};

export type ResolveResponse = { metadata: VideoMetadata | null };
