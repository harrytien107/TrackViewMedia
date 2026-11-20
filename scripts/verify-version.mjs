import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const packageVersion = read('package.json').version;
const manifestVersion = read('public/manifest.json').version;
const firefoxManifest = read('manifests/firefox-mv2.json');
const lock = read('package-lock.json');

if (packageVersion !== manifestVersion || packageVersion !== lock.version ||
    packageVersion !== lock.packages[''].version || packageVersion !== firefoxManifest.version ||
    firefoxManifest.manifest_version !== 2) {
  console.error('Version mismatch between package.json, package-lock.json, and extension manifests.');
  process.exitCode = 1;
} else {
  console.log(`TrackViewMedia version ${packageVersion} verified.`);
}
