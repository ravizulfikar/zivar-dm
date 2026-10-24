import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import { startServer } from '../app/server.mjs';

const project = path.resolve(import.meta.dirname, '..');
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'handoff-'));
const payload = Buffer.alloc(256 * 1024, 73);
const source = http.createServer((req, res) => {
  if (req.url === '/page') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><a href="/archive.zip">Archive</a><a href="/dismiss.zip">Dismiss</a><a href="/browser.zip">Browser</a>');
  }
  if (req.url === '/release') { res.writeHead(302, { Location: '/opaque-asset' }); return res.end(); }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream', 'Content-Length': payload.length,
    'Content-Disposition': `attachment; filename="${req.url === '/opaque-asset' ? 'rustdesk-1.5.0-x86_64.exe' : 'archive.zip'}"`,
  });
  res.end(payload);
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${source.address().port}`;
const app = await startServer({ port: 0, dataDirectory: path.join(temporary, 'state'), downloadDirectory: path.join(temporary, 'downloads') });
async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Download handoff timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
let context;
try {
  const extension = path.join(temporary, 'extension');
  await fs.cp(path.join(project, 'extension'), extension, { recursive: true });
  const background = path.join(extension, 'background.js');
  await fs.writeFile(background, (await fs.readFile(background, 'utf8')).replace("'http://127.0.0.1:18765'", JSON.stringify(app.origin)));
  const profile = path.join(temporary, 'profile');
  await fs.mkdir(path.join(profile, 'Default'), { recursive: true });
  await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { prompt_for_download: true } }));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(token => chrome.storage.local.set({ token, captureDownloads: true }), app.token);
  const page = await context.newPage();
  await page.goto(origin + '/page');
  const browserItems = () => worker.evaluate(() => chrome.downloads.search({}));
  const infoForClick = async name => {
    const next = context.waitForEvent('page');
    await page.getByRole('link', { name, exact: true }).click();
    const info = await next;
    await info.locator('#start:not([disabled])').waitFor();
    return info;
  };
  const before = (await browserItems()).length;
  const info = await infoForClick('Archive');
  assert.equal((await browserItems()).length, before, 'Captured click must not create a native download');
  await info.getByRole('button', { name: 'Start download' }).click();
  await until(() => app.manager.jobs.some(job => job.filename === 'archive.zip' && job.status === 'completed'));
  assert.deepEqual(await fs.readFile(app.manager.jobs.find(job => job.filename === 'archive.zip').outputPath), payload);
  console.log('PASS: captured click has zero Chrome downloads and queues byte-exact output.');

  const protocol = await context.newCDPSession(page);
  // Playwright normally overrides Chrome target selection, which skips the
  // extension filename event. Restore Chrome behavior, including Ask where to save.
  await protocol.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  const next = context.waitForEvent('page');
  await page.goto(origin + '/release', { timeout: 10000 }).catch(() => {});
  const redirectedInfo = await next;
  await redirectedInfo.getByRole('heading', { name: 'rustdesk-1.5.0-x86_64.exe' }).waitFor();
  const id = Number(new URL(redirectedInfo.url()).searchParams.get('id'));
  const item = (await browserItems()).find(item => item.id === id);
  assert.equal(item.state, 'interrupted');
  assert.equal(item.error, 'USER_CANCELED');
  await redirectedInfo.getByRole('button', { name: 'Start download' }).click();
  await until(() => app.manager.jobs.some(job => job.filename === 'rustdesk-1.5.0-x86_64.exe' && job.status === 'completed'));
  assert.deepEqual(await fs.readFile(app.manager.jobs.find(job => job.filename === 'rustdesk-1.5.0-x86_64.exe').outputPath), payload);
  console.log('PASS: opaque redirect retains attachment filename; native item canceled; ZIVAR output matches source.');

  const dismissed = await infoForClick('Dismiss');
  const dismissedId = Number(new URL(dismissed.url()).searchParams.get('id'));
  const beforeClose = (await browserItems()).length;
  await dismissed.close();
  await until(() => worker.evaluate(async id => !(await chrome.storage.local.get(`download-info:${id}`))[`download-info:${id}`], dismissedId));
  assert.equal((await browserItems()).length, beforeClose, 'Closing info must not start Chrome');
  assert.equal(app.manager.jobs.some(job => job.url.endsWith('/dismiss.zip')), false);
  console.log('PASS: closing info does not start a browser or app download.');

  await protocol.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(temporary, 'browser-downloads'), eventsEnabled: true });
  const browserInfo = await infoForClick('Browser');
  await browserInfo.getByRole('button', { name: 'Continue in Chrome' }).click();
  await until(async () => (await browserItems()).some(item => item.url === origin + '/browser.zip' && item.state === 'complete'));
  assert.equal(app.manager.jobs.some(job => job.url.endsWith('/browser.zip')), false);
  console.log('PASS: explicit browser choice finishes without recapture.');
} finally {
  await context?.close();
  await app.close();
  source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(root)) throw new Error('Unsafe handoff test cleanup');
  await fs.rm(temporary, { recursive: true, force: true });
}
