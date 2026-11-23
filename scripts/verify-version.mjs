import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const packageVersion = read('package.json').version;
const manifestVersion = read('public/manifest.json').version;
const firefoxManifest = read('manifests/firefox-mv2.json');
const thoriumManifest = read('manifests/thorium-mv2.json');
const firefoxUpdates = read('firefox-updates.json');
const lock = read('package-lock.json');
const firefoxId = firefoxManifest.browser_specific_settings?.gecko?.id;
const firefoxUpdate = firefoxUpdates.addons?.[firefoxId]?.updates?.[0];
const thoriumUpdates = readFileSync(new URL('../thorium-updates.xml', import.meta.url), 'utf8');
const thoriumUpdateVersion = thoriumUpdates.match(/<updatecheck\b[^>]*\bversion="([^"]+)"/)?.[1];
const thoriumUpdateCodebase = thoriumUpdates.match(/<updatecheck\b[^>]*\bcodebase="([^"]+)"/)?.[1];
const thoriumUpdateAppId = thoriumUpdates.match(/<app\b[^>]*\bappid="([^"]+)"/)?.[1];

function extensionIdFromManifestKey(key) {
  const publicDer = Buffer.from(key, 'base64');
  const digest = createHash('sha256').update(publicDer).digest();
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (const byte of digest.subarray(0, 16)) id += alphabet[(byte >> 4) & 0x0f] + alphabet[byte & 0x0f];
  return id;
}

function versionParts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) return null;
  return version.split('.').map(Number);
}

function isAtMost(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index];
  }
  return true;
}

const thoriumId = extensionIdFromManifestKey(thoriumManifest.key);
const expectedFirefoxAsset = firefoxUpdate?.version
  ? `/releases/download/v${firefoxUpdate.version}/TrackViewMedia-Firefox-v${firefoxUpdate.version}.xpi`
  : null;
const expectedThoriumAsset = thoriumUpdateVersion
  ? `/releases/download/v${thoriumUpdateVersion}/TrackViewMedia-Thorium-v${thoriumUpdateVersion}.crx`
  : null;

if (packageVersion !== manifestVersion || packageVersion !== lock.version ||
    packageVersion !== lock.packages[''].version || packageVersion !== firefoxManifest.version ||
    packageVersion !== thoriumManifest.version || firefoxManifest.manifest_version !== 2 ||
    thoriumManifest.manifest_version !== 2 || !isAtMost(firefoxUpdate?.version, packageVersion) ||
    !expectedFirefoxAsset || !firefoxUpdate?.update_link?.endsWith(expectedFirefoxAsset) ||
    !isAtMost(thoriumUpdateVersion, packageVersion) || !expectedThoriumAsset ||
    !thoriumUpdateCodebase?.endsWith(expectedThoriumAsset) || thoriumUpdateAppId !== thoriumId) {
  console.error('Version mismatch between package.json, package-lock.json, extension manifests, and stable update metadata.');
  process.exitCode = 1;
} else {
  console.log(`TrackViewMedia version ${packageVersion} verified. Thorium stable feed: ${thoriumUpdateVersion}.`);
}
