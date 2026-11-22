import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const packageVersion = read('package.json').version;
const manifestVersion = read('public/manifest.json').version;
const firefoxManifest = read('manifests/firefox-mv2.json');
const firefoxUpdates = read('firefox-updates.json');
const lock = read('package-lock.json');
const firefoxId = firefoxManifest.browser_specific_settings?.gecko?.id;
const firefoxUpdate = firefoxUpdates.addons?.[firefoxId]?.updates?.[0];
const expectedFirefoxAsset = `/releases/download/v${packageVersion}/TrackViewMedia-Firefox-v${packageVersion}.xpi`;

if (packageVersion !== manifestVersion || packageVersion !== lock.version ||
    packageVersion !== lock.packages[''].version || packageVersion !== firefoxManifest.version ||
    firefoxManifest.manifest_version !== 2 || firefoxUpdate?.version !== packageVersion ||
    !firefoxUpdate?.update_link?.endsWith(expectedFirefoxAsset)) {
  console.error('Version mismatch between package.json, package-lock.json, extension manifests, and Firefox update metadata.');
  process.exitCode = 1;
} else {
  console.log(`TrackViewMedia version ${packageVersion} verified.`);
}
