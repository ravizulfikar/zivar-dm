// Desktop: completion notifications, one-shot "after all downloads" actions, start-with-Windows bridge.
// Power actions are recorded to a log (ZIVAR_TEST_POWER_LOG) instead of being performed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'power-'));
const powerLog = path.join(temporary, 'power.log');
const payload = Buffer.alloc(256 * 1024, 3);
const installer = Buffer.alloc(300 * 1024, 77);
const { createHash } = await import('node:crypto');
let feedHash = createHash('sha256').update(installer).digest('hex');
const source = http.createServer((req, res) => {
  if (req.url === '/latest.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ version: '99.0.0', url: '/ZIVAR-Setup-99.0.0.exe', sha256: feedHash, notes: 'Versi uji' })); }
  if (req.url.startsWith('/ZIVAR-Setup')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length }); return res.end(installer); }
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': payload.length }); res.end(payload);
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${source.address().port}`;
const env = { ...process.env, ZIVAR_UPDATE_FEED: `http://127.0.0.1:${source.address().port}/latest.json`, ZIVAR_PORT: '0', ZIVAR_DESKTOP_DATA_DIR: path.join(temporary, 'state'), ZIVAR_DESKTOP_DOWNLOAD_DIR: path.join(temporary, 'downloads'), ZIVAR_DESKTOP_TEST_MODE: '1', ZIVAR_TEST_POWER_LOG: powerLog };
delete env.ELECTRON_RUN_AS_NODE;
const logText = () => fs.readFile(powerLog, 'utf8').catch(() => '');
const until = async (predicate, ms = 20000) => { const start = Date.now(); while (!await predicate()) { if (Date.now() - start > ms) throw new Error('Timed out. Power log: ' + JSON.stringify(await logText())); await new Promise(r => setTimeout(r, 100)); } };
let desktop;
try {
  desktop = await electron.launch({ executablePath: process.env.ZIVAR_DESKTOP_EXE || path.join(project, 'node_modules/electron/dist/electron.exe'), args: process.env.ZIVAR_DESKTOP_EXE ? [] : [project], cwd: project, env, timeout: 60000 });
  const page = await desktop.firstWindow();
  await page.locator('#connection').filter({ hasText: 'Connected locally' }).waitFor();
  await page.locator('#setup-later').click();
  const api = (route, body) => page.evaluate(async ([route, body]) => {
    const token = document.querySelector('meta[name="pairing-token"]').content;
    const response = await fetch(route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return response.json();
  }, [route, body]);

  assert.equal(await page.locator('[data-after="shutdown"]').count(), 1);

  // App update: newer version found, installer downloaded through the queue and verified.
  await page.locator('#about-open').click();
  await page.locator('#update-check').click();
  await page.locator('#update-text').filter({ hasText: 'Version 99.0.0 is available' }).waitFor();
  await page.locator('#update-download').click();
  await until(async () => (await api('/api/state')).jobs.some(job => job.filename === 'ZIVAR-Setup-99.0.0.exe' && job.status === 'completed' && job.verified));
  // Downloaded and verified: the user can install with one click (the installer is recorded, not started, in tests).
  await page.locator('#update-install').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#update-dot').isVisible(), true, 'A ready update is flagged next to the version');
  await page.locator('#update-install').click();
  await until(async () => (await logText()).includes('install:setup:ZIVAR-Setup-99.0.0.exe'));
  await page.locator('#about-close').click();
  // A tampered installer (wrong checksum in the feed) is rejected and deleted.
  feedHash = '0'.repeat(64);
  await api('/api/downloads/' + (await api('/api/state')).jobs.find(job => job.filename === 'ZIVAR-Setup-99.0.0.exe').id + '/remove', {});
  await page.evaluate(() => window.zivarDesktop.checkUpdate());
  await page.evaluate(() => window.zivarDesktop.downloadUpdate());
  await until(async () => (await api('/api/state')).jobs.some(job => job.filename.startsWith('ZIVAR-Setup-99.0.0') && job.status === 'error' && /checksum/i.test(job.error)));
  assert.equal((await api('/api/state')).jobs.find(job => job.status === 'error').outputPath, null, 'A file with the wrong checksum must be deleted');
  assert.equal(await page.evaluate(() => window.zivarDesktop.setAutoStart(true)), true);
  await until(async () => (await logText()).includes('autostart:true'));

  await api('/api/settings', { afterAll: 'shutdown', notifications: true });
  await api('/api/downloads', { url: `${base}/first.zip` });
  await until(async () => (await logText()).includes('after-all:shutdown'));
  const log = await logText();
  assert.match(log, /notify:Download complete:first\.zip/);
  assert.equal((await api('/api/settings')).afterAll, 'none', '"After all" is one-shot and resets itself');

  // "Close ZIVAR" when done really exits the app.
  await api('/api/settings', { afterAll: 'quit' });
  await api('/api/downloads', { url: `${base}/second.zip` });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('App did not quit after downloads finished')), 20000); desktop.process().once('exit', () => { clearTimeout(timer); resolve(); }); });
  desktop = null;
  assert.match(await logText(), /after-all:quit/);
  console.log('PASS: update check + verified installer download (tampered one rejected), completion notification, one-shot shutdown action (recorded), quit-when-done exits, start-with-Windows bridge.');
} finally {
  if (desktop) await desktop.close().catch(() => {});
  source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(root)) throw new Error('Unsafe power test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
