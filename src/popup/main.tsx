import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { contextFromUrl } from '../shared/urls';
import { allSelections, clearSelections, SELECTED_PREFIX } from '../shared/storage';
import { exportFilename, toCsv, toJson } from '../shared/export';
import type { PageContext, VideoRecord } from '../shared/types';
import './popup.css';

function App() {
  const [context, setContext] = useState<PageContext | null>(null);
  const [selections, setSelections] = useState<VideoRecord[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const initial = contextFromUrl(tabs[0]?.url ?? '');
      if (active) setContext(initial);
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

  const currentCount = selections.filter((record) =>
    record.platform === context?.platform && record.username.toLowerCase() === context.username.toLowerCase(),
  ).length;

  return (
    <main>
      <header>
        <div className="logo" aria-hidden="true">▶</div>
        <div><h1>TrackViewMedia</h1><p>Public video insights</p></div>
        <span className="v">v0.1</span>
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

      <footer>Dates are shown only when verified. View counts may be abbreviated.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
