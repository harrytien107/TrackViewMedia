export type Platform = 'Instagram' | 'TikTok' | 'Facebook';

export type Metric = number | string | null;
export type DatePrecision = 'timestamp' | 'day' | 'month_day' | 'relative' | null;
export type MetadataSource = 'tile' | 'embedded' | 'video_page' | 'video_id' | 'manual' | null;

export interface VideoRecord {
  platform: Platform;
  username: string;
  video_id: string;
  video_url: string;
  caption: string | null;
  published_at: string | null;
  /** Source-provided calendar day, retained when an exact timestamp is unavailable. */
  published_date: string | null;
  /** A platform-provided relative label. Never treat this as an ISO timestamp. */
  published_relative?: string | null;
  /** A platform date label without a year, such as "Nov 18". */
  published_label?: string | null;
  date_precision?: DatePrecision;
  date_source?: MetadataSource;
  views_source?: MetadataSource;
  views: Metric;
  views_exact: boolean | null;
  likes: Metric;
  likes_exact: boolean | null;
  comments: Metric;
  comments_exact: boolean | null;
  collected_at: string;
}

export type VideoMetadata = Partial<Pick<VideoRecord,
  'caption' | 'published_at' | 'published_date' | 'published_relative' | 'published_label' | 'date_source' | 'views_source' | 'views' | 'views_exact' |
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

export type ResolveResponse = {
  metadata: VideoMetadata | null;
  status?: 'resolved' | 'cached' | 'unavailable' | 'rate_limited';
  diagnostic?: string;
  /** Epoch milliseconds when requesting this video again is useful. */
  retry_after?: number;
};

export type PageFetchRequest = {
  type: 'fetch-video-from-page';
  platform: Platform;
  id: string;
  url: string;
};

export type PageFetchResponse = {
  metadata: VideoMetadata | null;
  diagnostic: string;
};
