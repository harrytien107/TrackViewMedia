import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const packageVersion = read('package.json').version;
const manifestVersion = read('public/manifest.json').version;
const lock = read('package-lock.json');

if (packageVersion !== manifestVersion || packageVersion !== lock.version ||
    packageVersion !== lock.packages[''].version) {
  console.error('Version mismatch between package.json, package-lock.json, and public/manifest.json.');
  process.exitCode = 1;
} else {
  console.log(`TrackViewMedia version ${packageVersion} verified.`);
}
