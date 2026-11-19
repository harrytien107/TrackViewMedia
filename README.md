# TrackViewMedia

A local-only Chrome/Edge **Manifest V3 extension** for public Instagram Reels, TikTok profile videos, and Facebook Reels. It adds a publication-date badge, available view counts, and a selection button to detected video thumbnails. Selections persist across scrolls, tab navigation, and extension reloads.

## Build and install

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm test
```

Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, choose **Load unpacked**, then select the generated **`dist/`** directory. After making changes, rebuild and click the extension's **Reload** icon.

Browse a supported public profile, scroll to load Reels/videos, and use the **+** button on individual thumbnails. In the toolbar popup, choose **Export CSV**, **Export JSON**, or **Clear selection**. Exports include selected videos from all supported profiles, not just the current tab.

## Supported public-page examples

- Instagram: `https://www.instagram.com/ssam_kbbq/reels/`
- TikTok: `https://www.tiktok.com/@tungthitsizzlingsteak`
- Facebook: `https://www.facebook.com/profile.php?id=61574788228123&sk=reels_tab`

## Metadata behavior

- The extension reads timestamps from per-video thumbnail markup or video-ID-matched structured data when available. Bounded requests for individual public video pages provide a fallback, using the browser session where permitted. Requests wait at least 2.5 seconds between starts and are capped at 12 per 5 minutes. Complete results are cached for 7 days, incomplete results for 20 minutes, and unavailable results for 30 minutes.
- It never calculates dates from video IDs or invents missing timestamps. Verified timezone-aware/epoch timestamps are displayed in the viewer's local timezone, with full publication time in the tooltip. Verified calendar dates display without a time. Yearless platform labels such as `Nov 18` are preserved verbatim, with the missing year called out in the tooltip. Platform-provided relative dates appear with a `~` prefix and remain explicitly approximate. Without reliable date metadata, the badge reads **Date unavailable**.
- Exact view/like/comment counts are numbers. Abbreviated counts (such as `1.2M`) remain **strings** with corresponding `*_exact: false` flags. Missing fields are `null` in JSON and blank in CSV. Date precision and source fields are included in exports. `published_at` remains empty when only a calendar date, yearless date label, or relative label exists. CSV includes UTF-8 BOM and guards against spreadsheet formula injection. Exact publication times are stored in ISO 8601 UTC and **displayed in the viewer's local timezone**.
- Only selected videos are saved, using per-video keys in `chrome.storage.local`. No remote backend or cross-site historical tracking is used. Metadata fallback requests use only the three supported public hosts.

## Manual acceptance checklist

On each example profile, confirm that loaded video thumbnails show one badge and one selection button. Scroll and navigate away/back, ensuring badges do not duplicate. For videos with a timestamp, compare the tooltip against the source video page's timestamp in the same timezone; where unavailable, confirm the extension does not guess. Select different videos across profiles, close and reopen the popup, reload the extension, and verify that JSON/CSV include only the selected video IDs/URLs. Test inaccessible/private/deleted posts: the extension should display unavailable metadata without blocking normal browsing. Site DOM changes, geo/login walls and metadata visibility can limit real-world coverage.

Optional live diagnostics (require desktop Chrome and internet access):

```bash
npm run inspect:live
npm run inspect:fallback
```

These scripts run the built bundles with simulated extension APIs. The live overlay inspector mocks out fallback fetch responses, while `inspect:fallback` checks single-Reel metadata fetching. They supplement unit tests, but are not a replacement for trying the unpacked extension in your browser. Headless Chrome detected 12 Instagram and 10 Facebook Reel tiles in the supplied profiles. Facebook's first three Reel badges showed Mar 19, Mar 13, and Mar 11, 2026, and its single-Reel fallback returned an exact timestamp. Instagram's single-Reel fallback also returned an exact timestamp. The supplied TikTok profile did not expose video tiles to the headless test browser; its live behavior is unverified.

## Code map

`src/content/adapters/` contains the three independent platform adapters; `src/content/index.ts` manages badges, observers, selection, and SPA navigation; `src/background/index.ts` handles bounded metadata fallback requests/cache; `src/shared/` contains typed records, parsing, storage, exports; `src/popup/` is the React popup. Vite builds the popup and esbuild emits standalone MV3 content/background bundles.
