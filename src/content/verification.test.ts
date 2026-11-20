// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.tiktok.com/@chef/video/123"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUserDate } from '../shared/metadata';
import { saveVerifiedMetadata } from '../shared/storage';

describe('individual video verification', () => {
  let shutdown: (() => void) | null = null;
  afterEach(() => { shutdown?.(); shutdown = null; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('captures a TikTok date and restores manually verified dates on profile tiles', async () => {
    vi.useFakeTimers();
    const saved: Record<string, unknown> = {};
    let messageHandler: ((message: unknown, sender: unknown, respond: (value: any) => void) => boolean) | null = null;
    const changes: ((entries: Record<string, { newValue: unknown }>, area: string) => void)[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({ metadata: null })),
        onMessage: { addListener: (listener: typeof messageHandler) => { messageHandler = listener; } },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string | null) => key === null ? { ...saved } : { [key]: saved[key] }),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            Object.assign(saved, entries);
            for (const listener of changes) {
              listener(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { newValue: value }])), 'local');
            }
          }),
          remove: vi.fn(async (key: string) => { delete saved[key]; }),
        },
        onChanged: { addListener: (listener: typeof changes[number]) => changes.push(listener) },
      },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 190, height: 270, left: 0, top: 0, right: 190, bottom: 270,
      toJSON: () => ({}),
    } as DOMRect);

    document.body.innerHTML = '<main><span data-e2e="browser-video-time">Nov 18</span></main>';
    const { stopTracking } = await import('./index');
    shutdown = stopTracking;
    await vi.advanceTimersByTimeAsync(170);
    expect(messageHandler).toBeTruthy();

    const result: any = await new Promise((resolve) => {
      messageHandler!({ type: 'verify-video' }, null, resolve);
    });
    expect(result.record).toMatchObject({ video_id: '123', published_label: 'Nov 18', date_source: 'video_page' });
    expect(saved['verified:TikTok:123']).toMatchObject({ published_label: 'Nov 18' });

    window.history.pushState({}, '', '/@chef');
    document.body.innerHTML = '<a href="/@chef/video/123"><img alt="Video" src="x" /></a>' +
      `<script type="application/json">${JSON.stringify({ item: {
        id: '123', createTime: Math.floor(Date.parse('2026-11-17T11:00:00Z') / 1000),
      } })}</script>`;
    await vi.advanceTimersByTimeAsync(170);
    const overlay = document.querySelector<HTMLDivElement>('[data-track-view-media="overlay"]');
    expect(overlay?.shadowRoot?.querySelector('.date')?.textContent).toContain('17');

    // A user can correct an incorrect automatic timestamp with a yearless date.
    const manuallyRead = parseUserDate('Nov 18');
    expect(manuallyRead).toMatchObject({ published_label: 'Nov 18', date_source: 'manual' });
    await saveVerifiedMetadata(result.record, manuallyRead!);
    await vi.advanceTimersByTimeAsync(170);
    expect(overlay?.shadowRoot?.querySelector('.date')?.textContent).toBe('Nov 18');
    expect(overlay?.shadowRoot?.querySelector<HTMLElement>('.date')?.title)
      .toContain('Year and exact publication time unavailable');
    expect(overlay?.dataset.tvmDateSource).toBe('manual');
  });
});
