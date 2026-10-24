import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { translateMessage } from '../app/messages.mjs';
import { stringDictionaries } from '../desktop/strings.mjs';
import { isNewer, installKind, pickAsset, installGroup, safeFilename } from '../desktop/updater.mjs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const sandbox = { window: {}, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'en' }, document: {} };
vm.runInNewContext(read('app/public/i18n.js'), sandbox);
const { en, id } = sandbox.window.ZIVAR_I18N.dictionaries;
const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

test('interface dictionaries have the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.equal(params(id[key]), params(en[key]), `placeholders differ for ${key}`);
});

test('every key used by the page and its script exists', () => {
  const html = read('app/public/index.html'), script = read('app/public/app.js');
  const used = new Set();
  for (const match of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.add(match[1]);
  for (const match of script.matchAll(/\bt\('([^']+)'/g)) used.add(match[1]);
  // Keys that are assembled at run time.
  for (const status of ['queued', 'downloading', 'pausing', 'paused', 'assembling', 'completed', 'cancelling', 'cancelled', 'error']) used.add(`status.${status}`);
  for (const name of ['video', 'audio', 'image', 'document', 'archive', 'program', 'other']) used.add(`cat.${name}`);
  for (const name of ['all', 'unfinished', 'queued', 'completed']) used.add(`nav.${name}`);
  for (const name of ['none', 'quit', 'sleep', 'shutdown']) used.add(`after.${name}`);
  for (const name of ['pause', 'resume', 'open']) used.add(`act.${name}`);
  for (const key of used) assert.ok(key in en, `missing English text for ${key}`);
});

test('desktop strings: dictionaries match and every key in use exists', () => {
  const { en: desktopEn, id: desktopId } = stringDictionaries;
  assert.deepEqual(Object.keys(desktopId).sort(), Object.keys(desktopEn).sort());
  for (const key of Object.keys(desktopEn)) assert.equal(params(desktopId[key]), params(desktopEn[key]), `placeholders differ for ${key}`);
  for (const match of read('desktop/main.mjs').matchAll(/\btr\('([^']+)'/g)) assert.ok(match[1] in desktopEn, `desktop text missing: ${match[1]}`);
});

test('engine messages are translated for English and untouched for Indonesian', () => {
  const sources = ['app/manager.mjs', 'app/server.mjs', 'app/youtube.mjs', 'app/media.mjs'];
  const missing = []; let scanned = 0;
  for (const file of sources) {
    for (const match of read(file).matchAll(/(?:new Error\(|error: |json\(res, \d+, \{ error: tr\()(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const text = match[2].replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, '7');
      if (!/[a-z]{3}/i.test(text) || text.length < 12) continue;
      scanned++;
      if (translateMessage(text, 'en') === text && !ENGLISH_OR_DYNAMIC.some(pattern => pattern.test(text))) missing.push(`${file}: ${text}`);
    }
  }
  assert.ok(scanned > 70, `the scanner only found ${scanned} messages`);
  assert.deepEqual(missing, [], 'add these messages to app/messages.mjs');
  assert.equal(translateMessage('Unduhan tidak ditemukan.', 'id'), 'Unduhan tidak ditemukan.');
  assert.equal(translateMessage('Unduhan tidak ditemukan.', 'en'), 'Download not found.');
  assert.equal(translateMessage('Server membalas HTTP 403. URL mungkin kedaluwarsa atau memerlukan login.', 'en'), 'The server replied HTTP 403. The URL may have expired or needs a login.');
});
// Messages that are already English or are assembled from a runtime value (stderr, exception text).
const ENGLISH_OR_DYNAMIC = [/^7$/, /^7[: ]/, /^HTTP 7$/];

test('updater: version comparison', () => {
  assert.equal(isNewer('0.17.1', '0.17.0'), true);
  assert.equal(isNewer('0.17.0', '0.17.0'), false);
  assert.equal(isNewer('0.9.9', '0.17.0'), false);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
});

test('updater: picks the right installer for how ZIVAR was installed', () => {
  const info = { version: '0.18.0', platforms: {
    'win32-x64': { url: 'https://x/setup.exe', sha256: 'a' }, 'win32-x64-portable': { url: 'https://x/portable.exe', sha256: 'b' },
    'linux-x64': { url: 'https://x/z.AppImage', sha256: 'c' }, 'linux-x64-deb': { url: 'https://x/z.deb', sha256: 'd' },
    'darwin-arm64': { url: 'https://x/z.dmg', sha256: 'e' } } };
  assert.equal(pickAsset(info, { platform: 'win32', arch: 'x64', kind: 'setup' }).sha256, 'a');
  assert.equal(pickAsset(info, { platform: 'win32', arch: 'x64', kind: 'portable' }).sha256, 'b');
  assert.equal(pickAsset(info, { platform: 'linux', arch: 'x64', kind: 'deb' }).sha256, 'd');
  assert.equal(pickAsset(info, { platform: 'linux', arch: 'x64', kind: 'rpm' }).sha256, 'c', 'falls back to the AppImage');
  assert.equal(pickAsset(info, { platform: 'darwin', arch: 'arm64', kind: 'dmg' }).sha256, 'e');
  assert.equal(pickAsset(info, { platform: 'darwin', arch: 'x64', kind: 'dmg' }), null, 'no build for this CPU');
  assert.deepEqual(pickAsset({ version: '1.0.0', url: 'https://x/a.exe', sha256: 'f' }, {}), { url: 'https://x/a.exe', sha256: 'f' }, 'older single-installer feeds still work');
});

test('updater: detects the install kind', () => {
  const none = () => false, only = path => file => file === path;
  assert.equal(installKind({ platform: 'win32', env: {}, execPath: 'C:\\app.exe', exists: none }), 'setup');
  assert.equal(installKind({ platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\p.exe' }, execPath: '', exists: none }), 'portable');
  assert.equal(installKind({ platform: 'darwin', env: {}, execPath: '', exists: none }), 'dmg');
  assert.equal(installKind({ platform: 'linux', env: { APPIMAGE: '/home/u/z.AppImage' }, execPath: '/tmp/.mount/zivar', exists: none }), 'appimage');
  assert.equal(installKind({ platform: 'linux', env: {}, execPath: '/opt/ZIVAR Download Manager/zivar', exists: only('/var/lib/dpkg/status') }), 'deb');
  assert.equal(installKind({ platform: 'linux', env: {}, execPath: '/opt/ZIVAR Download Manager/zivar', exists: only('/usr/bin/rpm') }), 'rpm');
  assert.equal(installKind({ platform: 'linux', env: {}, execPath: '/home/u/zivar/zivar', exists: none }), 'archive');
  assert.equal(installGroup('deb'), 'package'); assert.equal(installGroup('setup'), 'setup');
});

test('updater: file names from release URLs are safe', () => {
  assert.equal(safeFilename('https://github.com/o/r/releases/download/v1/ZIVAR-Setup-1.0.0.exe', '1.0.0', 'setup'), 'ZIVAR-Setup-1.0.0.exe');
  assert.equal(safeFilename('https://x/%2e%2e%2fevil.sh', '1.0.0', 'deb'), '.._evil.sh');
  assert.equal(safeFilename('https://x/download', '1.0.0', 'setup'), 'ZIVAR-1.0.0-setup.exe');
});

test('extension dictionaries match and every key in use exists', () => {
  const context = { chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } }, document: {} };
  context.globalThis = context;
  vm.runInNewContext(read('extension/i18n.js'), context);
  const { en: extEn, id: extId } = context.ZI.dictionaries;
  assert.deepEqual(Object.keys(extId).sort(), Object.keys(extEn).sort());
  for (const key of Object.keys(extEn)) assert.equal(params(extId[key]), params(extEn[key]), `placeholders differ for ${key}`);
  const used = new Set();
  for (const file of ['popup.js', 'download.js', 'content.js', 'background.js']) for (const match of read(`extension/${file}`).matchAll(/\bZI\.t\('([^']+)'/g)) used.add(match[1]);
  for (const file of ['popup.html', 'download.html']) for (const match of read(`extension/${file}`).matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.add(match[1]);
  assert.ok(used.size > 60, `only ${used.size} extension keys found`);
  for (const key of used) assert.ok(key in extEn, `missing extension text for ${key}`);
});

test('extension shows no Indonesian text of its own in the default language', () => {
  const html = read('extension/popup.html') + read('extension/download.html');
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /\b(Unduh|Hubungkan|Memeriksa|Tidak|Lanjutkan|Mulai|tidak|dengan)\b/);
});
