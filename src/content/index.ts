import { instagram } from './adapters/instagram';
import { tiktok } from './adapters/tiktok';
import { facebook } from './adapters/facebook';
import { contextFromUrl, identityFromUrl } from '../shared/urls';
import { datePrecision, localDate, mergeMetadata, metadataFromScriptTexts } from '../shared/metadata';
import { allSelections, removeSelection, saveSelection, selectionKey, updateSelectedMetadata, SELECTED_PREFIX } from '../shared/storage';
import type { Candidate, PageContext, ResolveRequest, ResolveResponse, VideoMetadata, VideoRecord } from '../shared/types';

const adapters = { Instagram: instagram, TikTok: tiktok, Facebook: facebook };
const overlays = new Map<HTMLAnchorElement, Overlay>();
const selected = new Map<string, VideoRecord>();
const nextAttempt = new Map<string, number>();
const structuredCache = new Map<string, VideoMetadata>();
let scripts: string[] = [];
let fallbackInFlight = false;
let currentHref = '';
let lastProfile: { platform: string; username: string } | null = null;
let scanScheduled = false;
let pageObserver: MutationObserver | null = null;
let locationPoll: number | null = null;
let retryTimer: number | null = null;

interface Overlay {
  anchor: HTMLAnchorElement;
  tile: HTMLElement;
  host: HTMLDivElement;
  date: HTMLElement;
  views: HTMLElement;
  selection: HTMLButtonElement;
  record: VideoRecord;
}

function profileName(ctx: PageContext): string {
  if (ctx.platform !== 'Facebook' || !/^\d+$/.test(ctx.username)) return ctx.username;
  const h1 = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
  return h1 && h1.length < 100 && !/^(reels|videos|posts)$/i.test(h1) ? h1 : ctx.username;
}

function candidateRecord(candidate: Candidate, ctx: PageContext): VideoRecord {
  const username = candidate.identity.username ||
    (ctx.username && profileName(ctx)) ||
    (lastProfile?.platform === ctx.platform ? lastProfile.username : '');
  const m = candidate.metadata;
  return {
    platform: ctx.platform, username, video_id: candidate.identity.id, video_url: candidate.identity.url,
    caption: m.caption ?? null, published_at: m.published_at ?? null,
    published_date: m.published_date ?? null,
    published_relative: m.published_relative ?? null,
    published_label: m.published_label ?? null,
    date_precision: datePrecision(m), date_source: m.date_source ?? null,
    views_source: m.views_source ?? null,
    views: m.views ?? null, views_exact: m.views_exact ?? null,
    likes: m.likes ?? null, likes_exact: m.likes_exact ?? null,
    comments: m.comments ?? null, comments_exact: m.comments_exact ?? null,
    collected_at: new Date().toISOString(),
  };
}

function mergeRecord(record: VideoRecord, ...parts: VideoMetadata[]): VideoRecord {
  const metadata = mergeMetadata(record, ...parts);
  return { ...record, ...metadata, date_precision: datePrecision(metadata) };
}

function render(overlay: Overlay): void {
  const key = selectionKey(overlay.record);
  const existing = selected.get(key);
  const { short, full } = localDate(overlay.record.published_at, overlay.record.published_date, overlay.record.published_relative, overlay.record.published_label ?? null);
  if (overlay.date.textContent !== short) overlay.date.textContent = short;
  overlay.date.title = `${full}${overlay.record.date_source ? ` (source: ${overlay.record.date_source})` : ''}`;
  overlay.host.dataset.tvmDateSource = overlay.record.date_source ?? 'unavailable';
  const count = overlay.record.views;
  const viewsText = count === null ? 'Views unavailable' :
    `${overlay.record.views_exact === false ? '≈ ' : ''}${String(count)} views`;
  if (overlay.views.textContent !== viewsText) overlay.views.textContent = viewsText;
  overlay.views.title = count === null ? 'No public view count found' :
    `${overlay.record.views_exact === false ? 'Abbreviated count (not exact)' : 'Exact count'}${overlay.record.views_source ? ` (source: ${overlay.record.views_source})` : ''}`;
  overlay.host.dataset.tvmViewsSource = overlay.record.views_source ?? 'unavailable';
  const pressed = !!existing;
  overlay.selection.setAttribute('aria-pressed', String(pressed));
  if (overlay.selection.textContent !== (pressed ? '✓' : '+')) overlay.selection.textContent = pressed ? '✓' : '+';
  overlay.selection.title = pressed ? 'Remove from export' : 'Select for export';
  overlay.selection.setAttribute('aria-label', pressed ? 'Deselect video for export' : 'Select video for export');
}

function createOverlay(candidate: Candidate, record: VideoRecord): Overlay {
  const host = document.createElement('div');
  host.dataset.trackViewMedia = 'overlay';
  host.style.cssText = 'position:absolute!important;inset:0!important;width:100%!important;height:100%!important;pointer-events:none!important;z-index:2147483000!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .info { position:absolute; left:6px; bottom:6px; display:flex; flex-direction:column;
        align-items:flex-start; gap:3px; max-width:calc(100% - 12px);
        font:600 11px/1.4 system-ui,-apple-system,sans-serif; color:#fff; }
      .badge { display:block; background:rgba(10,18,29,.88); padding:3px 6px;
        border-radius:5px; box-sizing:border-box; white-space:nowrap; overflow:hidden;
        text-overflow:ellipsis; max-width:100%; pointer-events:auto; }
      button { position:absolute;top:7px;right:7px;pointer-events:auto;cursor:pointer;
        width:29px;height:29px;border-radius:8px;border:1px solid rgba(255,255,255,.9);
        background:rgba(8,16,26,.85);color:#fff;font:700 20px/1 system-ui;
        display:grid;place-items:center; }
      button[aria-pressed="true"] { background:#12a67a; }
      button:focus-visible {outline:3px solid #ffdf69;outline-offset:2px;}
    </style>
    <div class="info"><span class="badge date"></span><span class="badge views"></span></div>
    <button type="button" aria-pressed="false"></button>`;
  const date = shadow.querySelector<HTMLElement>('.date')!;
  const views = shadow.querySelector<HTMLElement>('.views')!;
  const selection = shadow.querySelector<HTMLButtonElement>('button')!;
  // Restore the original positioning when removing the badge.
  if (getComputedStyle(candidate.tile).position === 'static') {
    candidate.tile.dataset.tvmPosition = candidate.tile.style.position;
    candidate.tile.style.position = 'relative';
  }
  candidate.tile.appendChild(host);
  const overlay: Overlay = { anchor: candidate.anchor, tile: candidate.tile, host, date, views, selection, record };
  selection.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const key = selectionKey(overlay.record);
    if (selected.has(key)) {
      selected.delete(key);
      void removeSelection(overlay.record);
    } else {
      const toStore = { ...overlay.record, collected_at: new Date().toISOString() };
      selected.set(key, toStore);
      void saveSelection(toStore);
    }
    for (const item of overlays.values()) if (selectionKey(item.record) === key) render(item);
    pumpFallback();
  });
  // Prevent parent sites listening for mousedown/pointerdown from navigating.
  for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'dblclick']) {
    selection.addEventListener(eventName, (event) => { event.stopPropagation(); });
  }
  render(overlay);
  return overlay;
}

function removeOverlay(overlay: Overlay): void {
  overlay.host.remove();
  const other = Array.from(overlays.values()).some((v) => v !== overlay && v.tile === overlay.tile);
  if (!other && overlay.tile.dataset.tvmPosition !== undefined) {
    overlay.tile.style.position = overlay.tile.dataset.tvmPosition;
    delete overlay.tile.dataset.tvmPosition;
  }
  overlays.delete(overlay.anchor);
}

function needsFallback(record: VideoRecord): boolean {
  return (!record.published_at || record.views === null) && !!record.video_url;
}

function visible(tile: HTMLElement): boolean {
  const rect = tile.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function pumpFallback(): void {
  if (fallbackInFlight) return;
  const eligible = Array.from(overlays.values())
    .filter((overlay) => needsFallback(overlay.record) &&
      (selected.has(selectionKey(overlay.record)) || visible(overlay.tile)))
    .sort((a, b) => Number(selected.has(selectionKey(b.record))) - Number(selected.has(selectionKey(a.record))));
  const overlay = eligible.find((item) =>
    (nextAttempt.get(selectionKey(item.record)) ?? 0) <= Date.now());
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = null;
  if (!overlay) {
    const next = Math.min(...eligible.map((item) => nextAttempt.get(selectionKey(item.record)) ?? Infinity));
    if (Number.isFinite(next)) retryTimer = window.setTimeout(() => {
      retryTimer = null;
      pumpFallback();
    }, Math.max(1000, next - Date.now()));
    return;
  }
  fallbackInFlight = true;
  void fallback(overlay).finally(() => {
    fallbackInFlight = false;
    pumpFallback();
  });
}

async function fallback(overlay: Overlay): Promise<void> {
  const { platform, video_id, video_url } = overlay.record;
  const key = selectionKey(overlay.record);
  // Prevent simultaneous scans from enqueuing repeated requests for the same video.
  nextAttempt.set(key, Date.now() + 5 * 60_000);
  try {
    const request: ResolveRequest = { type: 'resolve-metadata', platform, id: video_id, url: video_url };
    const response = await chrome.runtime.sendMessage<ResolveRequest, ResolveResponse>(request);
    if (response?.retry_after) nextAttempt.set(key, Math.max(Date.now() + 30_000, response.retry_after));
    else nextAttempt.set(key, Date.now() + (response?.metadata ? 30 * 60_000 : 6 * 60 * 60_000));
    if (!response?.metadata) return;
    for (const item of overlays.values()) {
      if (selectionKey(item.record) !== key) continue;
      item.record = mergeRecord(item.record, response.metadata);
      item.host.dataset.tvmFetchStatus = response.status ?? 'resolved';
      render(item);
      if (selected.has(selectionKey(item.record))) void updateSelectedMetadata(item.record, response.metadata);
    }
  } catch {
    nextAttempt.set(key, Date.now() + 5 * 60_000);
  }
}

function refreshScripts(): void {
  scripts = Array.from(document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[id="SIGI_STATE"], script[id="__NEXT_DATA__"], script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]',
  )).map((script) => script.textContent ?? '').filter((text) => text.length < 2_000_000);
  structuredCache.clear();
}

function scan(): void {
  scanScheduled = false;
  const ctx = contextFromUrl(location.href);
  if (currentHref !== location.href) {
    currentHref = location.href;
    refreshScripts();
    if (ctx?.kind === 'profile') lastProfile = { platform: ctx.platform, username: ctx.username };
    for (const overlay of Array.from(overlays.values())) removeOverlay(overlay);
  }
  if (!ctx) {
    for (const overlay of Array.from(overlays.values())) removeOverlay(overlay);
    return;
  }
  for (const item of Array.from(overlays.values())) {
    if (!item.anchor.isConnected || !item.tile.isConnected ||
      identityFromUrl(item.anchor.href, item.record.platform)?.id !== item.record.video_id) {
      removeOverlay(item);
    }
  }
  const candidates = adapters[ctx.platform].discover();
  for (const candidate of candidates) {
    const existing = overlays.get(candidate.anchor);
    if (existing && (existing.record.video_id !== candidate.identity.id || existing.tile !== candidate.tile)) {
      removeOverlay(existing);
    }
    if (!structuredCache.has(candidate.identity.id)) {
      structuredCache.set(candidate.identity.id,
        metadataFromScriptTexts(scripts, candidate.identity.id, ctx.platform));
    }
    candidate.metadata = mergeMetadata(candidate.metadata, structuredCache.get(candidate.identity.id) ?? {});
    const record = candidateRecord(candidate, ctx);
    const selectedRecord = selected.get(selectionKey(record));
    const overlay = overlays.get(candidate.anchor);
    if (overlay) {
      overlay.record = mergeRecord(record, selectedRecord ?? {}, overlay.record, record);
      render(overlay);
    } else {
      const ready = mergeRecord(record, selectedRecord ?? {}, record);
      const added = createOverlay(candidate, ready);
      overlays.set(candidate.anchor, added);
    }
    const active = overlays.get(candidate.anchor)!;
    if (selectedRecord) {
      const fresh = mergeMetadata(selectedRecord, active.record);
      if (JSON.stringify(fresh) !== JSON.stringify(mergeMetadata(selectedRecord))) {
        void updateSelectedMetadata(active.record, fresh);
      }
    }
  }
  pumpFallback();
}

function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  window.setTimeout(scan, 140);
}

async function initialize(): Promise<void> {
  try {
    for (const record of await allSelections()) selected.set(selectionKey(record), record);
  } catch { /* storage may be unavailable during extension updates */ }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    for (const [key, value] of Object.entries(changes)) {
      if (!key.startsWith(SELECTED_PREFIX)) continue;
      if (value.newValue) selected.set(key, value.newValue as VideoRecord);
      else selected.delete(key);
      changed = true;
    }
    if (changed) for (const overlay of overlays.values()) {
      const record = selected.get(selectionKey(overlay.record));
      if (record) overlay.record = { ...overlay.record, ...mergeMetadata(overlay.record, record) };
      render(overlay);
    }
  });
  chrome.runtime.onMessage.addListener((message: unknown, _sender, respond: (value: PageContext | null) => void) => {
    if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'get-context') return false;
    const ctx = contextFromUrl(location.href);
    respond(ctx ? { ...ctx, username: ctx.kind === 'profile' ? profileName(ctx) : ctx.username } : null);
    return false;
  });
  pageObserver = new MutationObserver((records) => {
    const scriptsChanged = records.some((record) => record.type === 'childList' && (
      record.target instanceof HTMLScriptElement ||
      Array.from(record.addedNodes).some((node) => node instanceof HTMLScriptElement ||
        (node instanceof Element && !!node.querySelector(
          'script[type="application/json"], script[id="SIGI_STATE"], script[id="__NEXT_DATA__"], script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]',
        )))
    ));
    if (scriptsChanged) refreshScripts();
    scheduleScan();
  });
  pageObserver.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('hashchange', scheduleScan);
  window.addEventListener('scroll', scheduleScan, { capture: true, passive: true });
  window.addEventListener('resize', scheduleScan);
  // SPA history changes don't always emit popstate.
  locationPoll = window.setInterval(() => { if (location.href !== currentHref) scheduleScan(); }, 900);
  scheduleScan();
}

/** Used by tests; extension content scripts otherwise live as long as the document. */
export function stopTracking(): void {
  pageObserver?.disconnect();
  if (locationPoll !== null) window.clearInterval(locationPoll);
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  window.removeEventListener('popstate', scheduleScan);
  window.removeEventListener('hashchange', scheduleScan);
  window.removeEventListener('scroll', scheduleScan, true);
  window.removeEventListener('resize', scheduleScan);
  for (const item of Array.from(overlays.values())) removeOverlay(item);
}

void initialize();
