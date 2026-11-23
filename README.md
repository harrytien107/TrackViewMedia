# TrackViewMedia

TrackViewMedia shows **publication dates**, **view counts**, and **selection/export tools** on public:

- Instagram Reels
- TikTok videos
- Facebook Reels
- YouTube Shorts

## Install

### Thorium - recommended

1. Download the latest `TrackViewMedia-Thorium-vX.Y.Z.crx` from GitHub Releases.
2. Open `thorium://extensions`.
3. Enable **Developer mode** if needed.
4. Install the `.crx` file.

Thorium uses the extension's MV2 update channel and can receive newer signed CRX releases automatically.

After the signed CRX is installed once, Thorium handles later stable updates in the background from TrackViewMedia's self-hosted update feed. There is no TrackViewMedia update popup.

> `Load unpacked` is for development and does not auto-update.

### Chrome / Edge

1. Download and extract the Chrome release ZIP.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `dist/`.

### Firefox

Install the Firefox `.xpi` release. Automatic updates require a Mozilla-signed build.

## How to use

1. Open a supported profile's Reels, videos, or Shorts page.
2. TrackViewMedia adds the available date and view count to each detected video.
3. Scroll normally. Newly loaded videos are detected automatically.
4. Click `+` to select videos.
5. Open the extension popup.
6. Export the selected videos as **CSV** or **JSON**.

Selections stay saved across navigation and extension reloads.

## Date behavior

TrackViewMedia only shows dates it can reliably obtain.

- Exact timestamp -> exact local date/time
- Calendar date -> calendar date
- Relative date -> approximate date
- No reliable metadata -> `Date unavailable`

It does not invent missing dates.

## Build from source

Requires Node.js 20+.

```bash
npm install
npm test
npm run build
```

| Browser | Build folder |
| --- | --- |
| Chrome / Edge MV3 | `dist/` |
| Firefox MV2 | `dist-firefox/` |
| Thorium MV2 | `dist-thorium/` |

## Releases

GitHub Actions packages Chrome, Firefox, and Thorium builds when a version tag is pushed. A stable release requires the `THORIUM_EXTENSION_KEY_B64` repository secret so every Thorium CRX keeps the same extension identity.

The workflow publishes the signed CRX first, verifies the published asset, and only then advances `thorium-updates.xml`. The Thorium extension ID is pinned to `emnohnennfenceofedpnifgfjnbagdig`.

Thorium releases must always use the same private signing key. The local key is stored at `keys/thorium-extension.pem` and is excluded from Git.

## Privacy

- No TrackViewMedia backend server
- Selections are stored locally in the browser
- Metadata requests are limited to the supported social platforms

**Current version: v0.3.0**
