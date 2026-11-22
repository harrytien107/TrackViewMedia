import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const packageVersion = read('package.json').version;
const manifestVersion = read('public/manifest.json').version;
const firefoxManifest = read('manifests/firefox-mv2.json');
const thoriumManifest = read('manifests/thorium-mv2.json');
const firefoxUpdates = read('firefox-updates.json');
const lock = read('package-lock.json');
const firefoxId = firefoxManifest.browser_specific_settings?.gecko?.id;
const firefoxUpdate = firefoxUpdates.addons?.[firefoxId]?.updates?.[0];
const expectedFirefoxAsset = `/releases/download/v${packageVersion}/TrackViewMedia-Firefox-v${packageVersion}.xpi`;
const thoriumUpdates = readFileSync(new URL('../thorium-updates.xml', import.meta.url), 'utf8');
const expectedThoriumAsset = `/releases/download/v${packageVersion}/TrackViewMedia-Thorium-v${packageVersion}.crx`;
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

const thoriumId = extensionIdFromManifestKey(thoriumManifest.key);

if (packageVersion !== manifestVersion || packageVersion !== lock.version ||
    packageVersion !== lock.packages[''].version || packageVersion !== firefoxManifest.version ||
    packageVersion !== thoriumManifest.version ||
    firefoxManifest.manifest_version !== 2 || firefoxUpdate?.version !== packageVersion ||
    thoriumManifest.manifest_version !== 2 ||
    !firefoxUpdate?.update_link?.endsWith(expectedFirefoxAsset) ||
    thoriumUpdateVersion !== packageVersion || !thoriumUpdateCodebase?.endsWith(expectedThoriumAsset) ||
    thoriumUpdateAppId !== thoriumId) {
  console.error('Version mismatch between package.json, package-lock.json, extension manifests, and update metadata.');
  process.exitCode = 1;
} else {
  console.log(`TrackViewMedia version ${packageVersion} verified.`);
}
