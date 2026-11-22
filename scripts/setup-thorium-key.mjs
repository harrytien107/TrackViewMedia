import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const keyPath = 'keys/thorium-extension.pem';
const manifestPath = 'manifests/thorium-mv2.json';
const updatePath = 'thorium-updates.xml';

await mkdir('keys', { recursive: true });

let privateKeyPem;
if (existsSync(keyPath)) {
  privateKeyPem = await readFile(keyPath, 'utf8');
} else {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKeyPem = privateKey;
  await writeFile(keyPath, privateKeyPem, { mode: 0o600 });
}

const { createPrivateKey, createPublicKey } = await import('node:crypto');
const privateKey = createPrivateKey(privateKeyPem);
const publicDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const publicKeyBase64 = publicDer.toString('base64');
const digest = createHash('sha256').update(publicDer).digest();
const alphabet = 'abcdefghijklmnop';
let extensionId = '';
for (const byte of digest.subarray(0, 16)) {
  extensionId += alphabet[(byte >> 4) & 0x0f] + alphabet[byte & 0x0f];
}

const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const manifest = {
  manifest_version: 2,
  name: 'TrackViewMedia (Thorium)',
  version: packageVersion,
  description: 'Show verified publication dates and available views on public Reels and videos; export selected items.',
  key: publicKeyBase64,
  update_url: 'https://raw.githubusercontent.com/harrytien107/TrackViewMedia/main/thorium-updates.xml',
  permissions: [
    'storage',
    'downloads',
    'https://*.instagram.com/*',
    'https://*.tiktok.com/*',
    'https://*.facebook.com/*',
  ],
  browser_action: { default_popup: 'popup.html', default_title: 'TrackViewMedia' },
  background: { scripts: ['background.js'], persistent: false },
  content_scripts: [{
    matches: [
      'https://*.instagram.com/*',
      'https://*.tiktok.com/*',
      'https://*.facebook.com/*',
    ],
    js: ['content.js'],
    run_at: 'document_idle',
  }],
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const codebase = `https://github.com/harrytien107/TrackViewMedia/releases/download/v${packageVersion}/TrackViewMedia-Thorium-v${packageVersion}.crx`;
const updateXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n` +
  `  <app appid="${extensionId}">\n` +
  `    <updatecheck codebase="${codebase}" version="${packageVersion}" />\n` +
  `  </app>\n` +
  `</gupdate>\n`;
await writeFile(updatePath, updateXml);

console.log(`Thorium extension ID: ${extensionId}`);
console.log(`Private signing key saved locally at ${keyPath} (gitignored).`);
