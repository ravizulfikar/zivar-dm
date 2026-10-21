import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'desktop-'));
const state = path.join(temporary, 'state'), downloads = path.join(temporary, 'downloads');
await fs.mkdir(state, { recursive: true });
const payload = Buffer.alloc(32 * 1024 * 1024, 91);
const source = http.createServer((req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(range?.[1] || 0), end = range?.[2] ? Number(range[2]) : payload.length - 1;
  const headers = { 'Content-Type': 'application/zip', 'Content-Length': end - start + 1, ETag: '"desktop-test"' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${payload.length}`;
  res.writeHead(range ? 206 : 200, headers);
  let offset = start;
  const timer = setInterval(() => { if (offset > end) { clearInterval(timer); res.end(); return; } const next = Math.min(offset + 16384, end + 1); res.write(payload.subarray(offset, next)); offset = next; }, 15);
  res.on('close', () => clearInterval(timer));
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${source.address().port}/desktop-test.zip`;
let desktop;
const cleanEnvironment = { ...process.env };
delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({
  executablePath: process.env.ZIVAR_DESKTOP_EXE || path.join(project, 'node_modules/electron/dist/electron.exe'),
  args: process.env.ZIVAR_DESKTOP_EXE ? [] : [project],
  cwd: project,
  env: { ...cleanEnvironment, ZIVAR_PORT: '0', ZIVAR_DESKTOP_DATA_DIR: state, ZIVAR_DESKTOP_DOWNLOAD_DIR: downloads, ZIVAR_DESKTOP_TEST_MODE: '1' },
  timeout: 60000,
});
try {
  desktop = await launch();
  const page = await desktop.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#edition-label').filter({ hasText: 'Pengelola unduhan desktop' }).waitFor();
  await page.locator('#connection').filter({ hasText: 'Terhubung lokal' }).waitFor();
  const info = await page.evaluate(() => window.zivarDesktop.getInfo());
  assert.equal(info.attached, false); assert.equal(info.downloadDirectory, downloads);
  assert.equal(info.showSetup, true);
  await page.locator('#setup-dialog[open]').waitFor();
  assert.equal(await page.locator('.setup-steps li').count(), 3);
  assert.equal(await page.locator('#extension-path').inputValue(), info.extensionDirectory);
  await page.locator('#setup-copy-address').click();
  assert.equal(await desktop.evaluate(({ clipboard }) => clipboard.readText()), 'chrome://extensions');
  await page.locator('#copy-token').click();
  const copied = await desktop.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(copied, /^[a-f0-9]{48}$/);
  await page.screenshot({ path: path.join(project, 'artifacts', 'setup-guide.png'), fullPage: true });
  await page.locator('#setup-finish').click();
  await page.locator('#setup-dialog[open]').waitFor({ state: 'hidden' });
  await page.locator('#show-setup').click();
  await page.locator('#setup-dialog[open]').waitFor();
  await page.locator('#setup-later').click();
  await fs.access(path.join(info.extensionDirectory, 'manifest.json'));
  const security = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(security.nodeIntegration, false); assert.equal(security.sandbox, true); assert.equal(security.contextIsolation, true);
  assert.equal(await page.evaluate(() => typeof require), 'undefined');
  await page.locator('#tb-add').click(); await page.locator('#url').fill(url); await page.locator('#add-button').click();
  await page.waitForFunction(() => parseFloat(document.querySelector('.progress>span')?.style.width) > 0);
  await page.screenshot({ path: path.join(project, 'artifacts', 'desktop-app.png'), fullPage: true });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'Closing the window must keep the tray engine alive');
  await page.locator('#menu-tasks').click(); await page.locator('#quit-app').click();
  await new Promise(resolve => { if (desktop.process().exitCode !== null) resolve(); else desktop.process().once('exit', resolve); });
  desktop = null;
  const snapshot = JSON.parse(await fs.readFile(path.join(state, 'jobs.json'), 'utf8'));
  assert.equal(snapshot[0].status, 'paused');
  desktop = await launch();
  const restored = await desktop.firstWindow();
  await restored.locator('#edition-label').filter({ hasText: 'Pengelola unduhan desktop' }).waitFor();
  assert.equal((await restored.evaluate(() => window.zivarDesktop.getInfo())).showSetup, false);
  assert.equal(await restored.locator('#setup-dialog').evaluate(dialog => dialog.open), false);
  await restored.locator('.badge.paused').waitFor();
  await restored.locator('.job', { hasText: 'desktop-test.zip' }).click(); await restored.locator('#tb-resume').click();
  await restored.locator('.badge.completed').waitFor({ timeout: 20000 });
  const saved = JSON.parse(await fs.readFile(path.join(state, 'jobs.json'), 'utf8'));
  assert.deepEqual(await fs.readFile(saved[0].outputPath), payload);
  await assert.rejects(restored.evaluate(() => window.zivarDesktop.openFile('C:\\Windows\\win.ini')), /tidak diizinkan/, 'Only files inside the download folder may be opened');
  assert.deepEqual(errors, []);
  console.log('PASS: first-run tutorial, copy buttons, persistent dismissal, manual tutorial reopening, desktop sandbox/IPC, extension resources, tray close, graceful shutdown, persisted pause/resume, exact bytes.');
} finally {
  if (desktop) await desktop.close().catch(() => {});
  source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(root)) throw new Error('Unsafe desktop test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
