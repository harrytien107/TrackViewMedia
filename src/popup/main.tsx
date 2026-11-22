import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { contextFromUrl } from '../shared/urls';
import { identityFromUrl } from '../shared/urls';
import { datePrecision, localDate, mergeMetadata, parseUserDate } from '../shared/metadata';
import { allSelections, clearSelections, saveSelection, saveVerifiedMetadata, SELECTED_PREFIX } from '../shared/storage';
import { exportFilename, toCsv, toJson } from '../shared/export';
import type { PageContext, VideoRecord } from '../shared/types';
import './popup.css';

interface Inspection {
  record: VideoRecord;
  diagnostics: { scripts_checked: number; date_source: string; views_source: string };
}

function emptyVideo(url: string, context: PageContext): VideoRecord | null {
  const identity = identityFromUrl(url, context.platform);
  if (!identity) return null;
  return {
    platform: context.platform, username: identity.username ?? context.username,
    video_id: identity.id, video_url: identity.url, caption: null,
    published_at: null, published_date: null, published_relative: null, published_label: null,
    date_precision: null, date_source: null, views_source: null,
    views: null, views_exact: null, likes: null, likes_exact: null,
    comments: null, comments_exact: null, collected_at: new Date().toISOString(),
  };
}

function App() {
  const [context, setContext] = useState<PageContext | null>(null);
  const [selections, setSelections] = useState<VideoRecord[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [videoTab, setVideoTab] = useState<{ id: number; url: string } | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [manualDate, setManualDate] = useState('');

  useEffect(() => {
    let active = true;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const initial = contextFromUrl(tabs[0]?.url ?? '');
      if (active) setContext(initial);
      if (active && initial?.kind === 'video' && tabs[0]?.id !== undefined) {
        setVideoTab({ id: tabs[0].id, url: tabs[0].url ?? '' });
      }
      if (!initial || tabs[0]?.id === undefined) return;
      try {
        const fromPage = await chrome.tabs.sendMessage<{ type: string }, PageContext | null>(
          tabs[0].id, { type: 'get-context' },
        );
        if (active && fromPage?.platform === initial.platform) setContext(fromPage);
      } catch { /* Inaccessible page or content script not ready: URL context is enough. */ }
    }).catch(() => {});
    const reload = () => void allSelections().then((records) => {
      if (active) setSelections(records);
    }).catch(() => { if (active) setStatus('Cannot read local selections.'); });
    reload();
    const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(SELECTED_PREFIX))) reload();
    };
    chrome.storage.onChanged.addListener(handler);
    return () => { active = false; chrome.storage.onChanged.removeListener(handler); };
  }, []);


  async function exportRecords(format: 'csv' | 'json') {
    if (!selections.length || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const fresh = await allSelections();
      if (!fresh.length) { setStatus('Nothing is selected.'); return; }
      const body = format === 'csv' ? toCsv(fresh) : toJson(fresh);
      const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
      const url = URL.createObjectURL(new Blob([body], { type: mime }));
      try {
        await chrome.downloads.download({ url, filename: exportFilename(format), saveAs: true, conflictAction: 'uniquify' });
        setStatus(`Exported ${fresh.length} selected video${fresh.length === 1 ? '' : 's'}.`);
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (error) { setStatus(`Export failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    finally { setBusy(false); }
  }

  async function clear() {
    if (!selections.length || busy) return;
    setBusy(true);
    try { await clearSelections(); setSelections([]); setStatus('Selections cleared.'); }
    catch { setStatus('Could not clear selections.'); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (!videoTab || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await chrome.tabs.sendMessage<{ type: string }, Inspection | null>(
        videoTab.id, { type: 'verify-video' },
      );
      if (result?.record) {
        setInspection(result);
        setStatus(result.record.date_precision
          ? 'Publication date captured from the video page.'
          : 'No readable publication date found. Enter the date shown on the video.');
      } else setStatus('This page does not expose video metadata. You can enter the displayed date below.');
    } catch {
      setStatus('Could not inspect this tab. Reload the video page or enter its displayed date.');
    } finally { setBusy(false); }
  }

  async function saveManual() {
    if (!context || !videoTab || busy) return;
    const parsed = parseUserDate(manualDate);
    if (!parsed) {
      setStatus('Use YYYY-MM-DD, 18 Nov 2026, Nov 18, 11-18, 3 days ago, or an ISO timestamp with timezone.');
      return;
    }
    const base = inspection?.record ?? emptyVideo(videoTab.url, context);
    if (!base) { setStatus('Open a specific video before entering its date.'); return; }
    setBusy(true);
    try {
      await saveVerifiedMetadata(base, parsed);
      const metadata = mergeMetadata(base, parsed);
      setInspection({
        record: {
          ...base, ...metadata,
          published_at: metadata.published_at ?? null,
          published_date: metadata.published_date ?? null,
          published_relative: metadata.published_relative ?? null,
          published_label: metadata.published_label ?? null,
          date_source: metadata.date_source ?? null,
          date_precision: datePrecision(metadata),
        },
        diagnostics: { scripts_checked: inspection?.diagnostics.scripts_checked ?? 0,
          date_source: 'manual', views_source: base.views_source ?? 'unavailable' },
      });
      setManualDate('');
      setStatus('Manual date saved for this video with its stated precision.');
    } catch { setStatus('Could not save this date.'); }
    finally { setBusy(false); }
  }

  async function selectVerified() {
    if (!inspection || busy) return;
    setBusy(true);
    try {
      await saveSelection({ ...inspection.record, collected_at: new Date().toISOString() });
      setStatus('Video added to selected exports.');
    } catch { setStatus('Could not select this video.'); }
    finally { setBusy(false); }
  }

  const currentCount = selections.filter((record) =>
    record.platform === context?.platform && record.username.toLowerCase() === context.username.toLowerCase(),
  ).length;

  return (
    <main>
      <header>
        <div className="logo" aria-hidden="true">▶</div>
        <div><h1>TrackViewMedia</h1><p>Public video insights</p></div>
        <span className="v">v{chrome.runtime.getManifest().version}</span>
      </header>

      <section className="location" aria-label="Current page">
        <p className="eyebrow">CURRENT PAGE</p>
        {context ? <>
          <div className="page"><span className="signal" />{context.platform}</div>
          <div className="username" title={context.username}>
            {context.username ? `${context.platform === 'TikTok' ? '@' : ''}${context.username}` : 'Individual video'}
          </div>
        </> : <div className="unavailable">Open a supported public profile to see thumbnail badges.</div>}
      </section>

      {context?.kind === 'video' && <section className="verification" aria-label="Video verification">
        <p className="eyebrow">VERIFY THIS VIDEO</p>
        <button className="secondary verify-button" disabled={busy} onClick={() => void verify()}>Verify Video</button>
        {inspection && <div className="inspection">
          <strong>{localDate(inspection.record.published_at, inspection.record.published_date,
            inspection.record.published_relative, inspection.record.published_label).short}</strong>
          <span>Source: {inspection.record.date_source ?? 'unavailable'} · Precision: {inspection.record.date_precision ?? 'unavailable'}</span>
          <span>Views: {inspection.record.views === null ? 'unavailable' : inspection.record.views} · Source: {inspection.record.views_source ?? 'unavailable'}</span>
          <span>Embedded scripts checked: {inspection.diagnostics.scripts_checked}</span>
          <button className="secondary select-video" disabled={busy} onClick={() => void selectVerified()}>Add to export</button>
        </div>}
        <label className="date-label" htmlFor="manual-date">Date shown on the video</label>
        <div className="manual-row">
          <input id="manual-date" type="text" value={manualDate} onChange={(event) => setManualDate(event.target.value)}
            placeholder="2026-11-18 or 3 days ago" />
          <button className="primary" disabled={busy || !manualDate.trim()} onClick={() => void saveManual()}>Save date</button>
        </div>
        <p className="date-help">Manual dates are recorded as manual. Missing years and relative labels stay approximate.</p>
      </section>}

      <section className="summary" aria-label="Selection summary">
        <div><strong>{selections.length}</strong><span>selected across all pages</span></div>
        <div className="divider" />
        <div><strong>{currentCount}</strong><span>from current profile</span></div>
      </section>

      <section className="actions">
        <p className="eyebrow">EXPORT SELECTED VIDEOS</p>
        <div className="action-row">
          <button className="primary" disabled={!selections.length || busy} onClick={() => void exportRecords('csv')}>↓ Export CSV</button>
          <button className="secondary" disabled={!selections.length || busy} onClick={() => void exportRecords('json')}>↓ Export JSON</button>
        </div>
        <button className="clear" disabled={!selections.length || busy} onClick={() => void clear()}>Clear selection</button>
        <p role="status" className="status">{status}</p>
      </section>

      <footer>Dates include their source and precision. View counts may be abbreviated.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
