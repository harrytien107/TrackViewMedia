import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

const EXPECTED_EXTENSION_ID = 'emnohnennfenceofedpnifgfjnbagdig';
const EXPECTED_UPDATE_URL = 'https://raw.githubusercontent.com/harrytien107/TrackViewMedia/main/thorium-updates.xml';
const args = process.argv.slice(2);

function valueFor(flag, fallback = null) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

const keyPath = valueFor('--key', 'keys/thorium-extension.pem');
const outputPath = valueFor('--output');
const crxPath = valueFor('--crx');
const manifestPath = 'manifests/thorium-mv2.json';

function readVarint(buffer, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value: Number(value), offset };
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new Error('Invalid protobuf varint in CRX header.');
}

function protobufBytesField(buffer, wantedField) {
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const field = tag.value >>> 3;
    const wire = tag.value & 7;
    if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + length.value;
      if (end > buffer.length) throw new Error('Invalid length-delimited field in CRX header.');
      if (field === wantedField) return buffer.subarray(offset, end);
      offset = end;
    } else if (wire === 0) {
      offset = readVarint(buffer, offset).offset;
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire} in CRX header.`);
    }
  }
  return null;
}

function extensionIdFromBytes(bytes) {
  const alphabet = 'abcdefghijklmnop';
  let id = '';
  for (const byte of bytes) id += alphabet[(byte >> 4) & 0x0f] + alphabet[byte & 0x0f];
  return id;
}

async function extensionIdFromCrx(crxPath) {
  const crx = await readFile(crxPath);
  if (crx.length < 12 || crx.subarray(0, 4).toString('ascii') !== 'Cr24') {
    throw new Error(`Packed Thorium CRX has an invalid header: ${crxPath}`);
  }
  if (crx.readUInt32LE(4) !== 3) throw new Error('Thorium release must be packaged as CRX3.');
  const headerSize = crx.readUInt32LE(8);
  const headerEnd = 12 + headerSize;
  if (headerEnd > crx.length) throw new Error('Packed Thorium CRX has a truncated CRX3 header.');
  const signedHeader = protobufBytesField(crx.subarray(12, headerEnd), 10000);
  if (!signedHeader) throw new Error('Packed Thorium CRX is missing signed header data.');
  const crxId = protobufBytesField(signedHeader, 1);
  if (!crxId || crxId.length !== 16) throw new Error('Packed Thorium CRX is missing its 16-byte CRX ID.');
  return extensionIdFromBytes(crxId);
}

if (!existsSync(keyPath)) throw new Error(`Thorium signing key is required at ${keyPath}.`);

const privateKeyPem = await readFile(keyPath, 'utf8');
const privateKey = createPrivateKey(privateKeyPem);
const publicDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const publicKeyBase64 = publicDer.toString('base64');
const digest = createHash('sha256').update(publicDer).digest();
const extensionId = extensionIdFromBytes(digest.subarray(0, 16));

const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== packageVersion) {
  throw new Error(`Thorium manifest version ${manifest.version} does not match package ${packageVersion}.`);
}
if (manifest.key !== publicKeyBase64) {
  throw new Error('Thorium signing key does not match the public key pinned in the manifest.');
}
if (extensionId !== EXPECTED_EXTENSION_ID) {
  throw new Error(`Thorium extension ID changed to ${extensionId}. Expected ${EXPECTED_EXTENSION_ID}.`);
}
if (manifest.update_url !== EXPECTED_UPDATE_URL) {
  throw new Error(`Unexpected Thorium update_url: ${manifest.update_url}`);
}

if (crxPath) {
  const crxExtensionId = await extensionIdFromCrx(crxPath);
  if (crxExtensionId !== EXPECTED_EXTENSION_ID) {
    throw new Error(`Packed Thorium CRX has extension ID ${crxExtensionId}. Expected ${EXPECTED_EXTENSION_ID}.`);
  }
}

const codebase = `https://github.com/harrytien107/TrackViewMedia/releases/download/v${packageVersion}/TrackViewMedia-Thorium-v${packageVersion}.crx`;
const updateXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n` +
  `  <app appid="${extensionId}">\n` +
  `    <updatecheck codebase="${codebase}" version="${packageVersion}" />\n` +
  `  </app>\n` +
  `</gupdate>\n`;

if (outputPath) await writeFile(outputPath, updateXml);

console.log(`Thorium ${packageVersion} signing identity verified: ${extensionId}`);
if (crxPath) console.log(`Packed CRX verified: ${crxPath}`);
if (outputPath) console.log(`Candidate update feed written to ${outputPath}`);
