import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import { startServer } from '../app/server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(project, 'tests', '.tmp');
await fs.mkdir(temporaryRoot, { recursive: true });
const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'extension-'));
const payload = Buffer.alloc(3 * 1024 * 1024, 73);
const source = http.createServer((req, res) => {
  if (req.url === '/page') { res.setHeader('Content-Type', 'text/html'); res.setHeader('Set-Cookie', 'sid=extension-smoke; Path=/'); res.end('<!doctype html><title>Video fixture</title><video controls preload="metadata" src="/media.mp4"></video><a href="/archive.zip">Download archive</a>'); return; }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(range?.[1] || 0), end = range?.[2] ? Number(range[2]) : payload.length - 1;
  const media = req.url === '/media.mp4';
  if (media && !String(req.headers.cookie || '').includes('sid=extension-smoke')) { res.writeHead(403); res.end('cookie required'); return; }
  const headers = { 'Content-Type': media ? 'video/mp4' : 'application/zip', 'Content-Length': end - start + 1, ETag: '"extension-fixture"' };
  if (!media) headers['Content-Disposition'] = 'attachment; filename="archive.zip"';
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${payload.length}`;
  res.writeHead(range ? 206 : 200, headers);
  let offset = start;
  const timer = setInterval(() => {
    if (offset > end) { clearInterval(timer); res.end(); return; }
    const next = Math.min(offset + 32768, end + 1); res.write(payload.subarray(offset, next)); offset = next;
  }, 8);
  res.on('close', () => clearInterval(timer));
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const sourceOrigin = `http://127.0.0.1:${source.address().port}`;
const app = await startServer({ port: 0, dataDirectory: path.join(temporary, 'state'), downloadDirectory: path.join(temporary, 'downloads') });
const waitFor = async predicate => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 15000) throw new Error('Extension operation timed out.'); await new Promise(resolve => setTimeout(resolve, 40)); } };
let context, popup;
try {
  const extension = path.join(temporary, 'extension');
  await fs.cp(path.join(project, 'extension'), extension, { recursive: true });
  const background = path.join(extension, 'background.js');
  await fs.writeFile(background, (await fs.readFile(background, 'utf8')).replace("'http://127.0.0.1:18765'", JSON.stringify(app.origin)));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#token').fill(app.token);
  await popup.getByRole('button', { name: 'Connect', exact: true }).click();
  await popup.locator('#status').filter({ hasText: 'Connected to the local app' }).waitFor();
  const integration = await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } }).then(response => response.json());
  assert.equal(integration.browserIntegration.connected, true);
  const demo = await context.newPage();
  await demo.goto(sourceOrigin + '/page');
  await popup.evaluate(async url => { const tabs = await chrome.tabs.query({}); await chrome.tabs.update(tabs.find(tab => tab.url === url).id, { active: true }); }, sourceOrigin + '/page');
  await popup.locator('#refresh').click();
  await popup.getByRole('button', { name: 'Download with ZIVAR' }).waitFor();
  await popup.getByRole('button', { name: 'Download with ZIVAR' }).click();
  await popup.locator('#message').filter({ hasText: 'Video added' }).waitFor();
  await waitFor(() => app.manager.jobs[0]?.status === 'completed');
  assert.deepEqual(await fs.readFile(app.manager.jobs[0].outputPath), payload);
  await popup.screenshot({ path: path.join(project, 'artifacts', 'extension.png') });
  await popup.locator('#capture').check();
  // Playwright takes over download handling through DevTools, which hides downloads from the extension's
  // onDeterminingFilename. Restore Chrome's own behaviour so the real interception path is exercised.
  await (await context.newCDPSession(popup)).send('Browser.setDownloadBehavior', { behavior: 'default' });
  const infoPromise = context.waitForEvent('page');
  await demo.goto(sourceOrigin + '/archive.zip').catch(() => {});
  const info = await infoPromise;
  await info.waitForLoadState();
  await info.getByRole('heading', { name: 'archive.zip' }).waitFor();
  assert.equal(await info.locator('#type').textContent(), 'application/zip');
  await info.getByRole('button', { name: 'Start download' }).click();
  await waitFor(() => app.manager.jobs.some(job => job.url.endsWith('/archive.zip') && job.status === 'completed'));
  const archiveJob = app.manager.jobs.find(job => job.url.endsWith('/archive.zip'));
  assert.deepEqual(await fs.readFile(archiveJob.outputPath), payload);
  await popup.locator('#capture').uncheck();
  await app.close();
  // App offline: the extension must let Chrome finish the download itself.
  await demo.goto(sourceOrigin + '/fallback.zip').catch(() => {});
  let fallbackItem;
  const started = Date.now();
  while (!fallbackItem) {
    if (Date.now() - started > 15000) throw new Error('Chrome did not finish the fallback download.');
    fallbackItem = (await popup.evaluate(() => chrome.downloads.search({ state: 'complete' }))).find(item => item.url.endsWith('/fallback.zip'));
    if (!fallbackItem) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(await fs.readFile(fallbackItem.filename), payload);
  console.log('PASS: real MV3 extension loads, pairing works, player/network media is detected, media transfers to app, Chrome handoff succeeds, Chrome resumes when app is offline.');
} catch (error) {
  if (popup && !popup.isClosed()) {
    console.error('Popup status:', await popup.locator('#status').textContent().catch(() => 'unavailable'));
    console.error('Popup message:', await popup.locator('#message').textContent().catch(() => 'unavailable'));
    await popup.screenshot({ path: path.join(project, 'artifacts', 'extension-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close(); await app.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(temporaryRoot)) throw new Error('Unsafe extension test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
