// UI features: settings (concurrency), batch add with patterns, search, checksum dialog,
// queue reordering, refresh address, "after all" menu, speed graph.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import { startServer } from '../app/server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(project, 'tests', '.tmp');
await fs.mkdir(temporaryRoot, { recursive: true });
const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'features-'));
const small = Buffer.alloc(64 * 1024, 5), large = Buffer.alloc(4 * 1024 * 1024, 9);
const source = http.createServer((req, res) => {
  const slow = req.url.startsWith('/slow/'), payload = slow ? large : small;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), payload.length - 1) : payload.length - 1;
  const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start + 1, ETag: '"features"' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${payload.length}`;
  res.writeHead(range ? 206 : 200, headers);
  let offset = start;
  const timer = setInterval(() => { if (offset > end) { clearInterval(timer); res.end(); return; } const next = Math.min(offset + 8192, end + 1); res.write(payload.subarray(offset, next)); offset = next; }, slow ? 40 : 1);
  res.on('close', () => clearInterval(timer));
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${source.address().port}`;
const app = await startServer({ port: 0, dataDirectory: path.join(temporary, 'state'), downloadDirectory: path.join(temporary, 'downloads') });
let browser;
const row = (page, name) => page.locator('.job', { hasText: name });
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(app.origin); await page.locator('#connection').filter({ hasText: 'Connected locally' }).waitFor();

  // Settings: one download at a time.
  await page.locator('#show-settings').click();
  await page.locator('#concurrency').fill('1'); await page.locator('#connections').fill('2');
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  assert.equal(app.manager.concurrency, 1); assert.equal(app.manager.connections, 2);

  await page.locator('#show-settings').click();
  await page.locator('#browser-download-types').fill('EXE, MSI, R0*');
  await page.locator('#browser-download-site-exclusions').fill('*.safe.example\nupdates.example');
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#settings-dialog').open);
  assert.deepEqual(app.manager.settings().browserDownloadTypes, ['EXE', 'MSI', 'R0*']);
  assert.deepEqual(app.manager.settings().browserDownloadSiteExclusions, ['*.safe.example', 'updates.example']);

  // Batch add with a numeric pattern.
  await page.locator('#tb-add').click(); await page.locator('#tab-batch').click();
  await page.locator('#batch-urls').fill(`${origin}/files/part[1-3].bin`);
  await page.locator('#batch-preview').filter({ hasText: '3 links' }).waitFor();
  await page.locator('#add-button').click();
  await page.waitForFunction(() => document.querySelectorAll('.job .badge.completed').length === 3, null, { timeout: 20000 });
  assert.deepEqual(app.manager.jobs.map(job => job.filename).sort(), ['part1.bin', 'part2.bin', 'part3.bin']);

  // Search.
  await page.locator('#search').fill('part2');
  await page.waitForFunction(() => document.querySelectorAll('.job').length === 1);
  await page.locator('#search').fill('');
  await page.waitForFunction(() => document.querySelectorAll('.job').length === 3);

  // Checksum dialog compares with a value from the "website".
  await row(page, 'part2.bin').click({ button: 'right' });
  await page.locator('#context-menu').getByRole('menuitem', { name: 'Verify checksum…' }).click();
  await page.locator('#checksum-run').click();
  const expected = createHash('sha256').update(small).digest('hex');
  await page.waitForFunction(value => document.querySelector('#checksum-result').value === value, expected);
  await page.locator('#checksum-expected').fill(expected.toUpperCase());
  await page.locator('#checksum-verdict.ok').waitFor();
  await page.locator('#checksum-expected').fill('deadbeef'); await page.locator('#checksum-verdict.bad').waitFor();
  await page.locator('#checksum-close').click();

  // Queue order: s1 downloads, s2/s3 wait; move s3 to the front.
  for (const name of ['s1', 's2', 's3']) {
    await page.locator('#tb-add').click(); await page.locator('#tab-single').click();
    await page.locator('#url').fill(`${origin}/slow/${name}.bin`); await page.locator('#add-button').click();
    await page.waitForFunction(() => !document.querySelector('#add-dialog').open);
  }
  await row(page, 's1.bin').locator('.badge.downloading').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.job')].find(r => r.textContent.includes('s3.bin'))?.querySelector('.meta-q').textContent === '#2');
  await row(page, 's3.bin').click();
  await row(page, 's3.bin').click({ button: 'right' });
  await page.locator('#context-menu').getByRole('menuitem', { name: 'Move to front of queue' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.job')].find(r => r.textContent.includes('s3.bin'))?.querySelector('.meta-q').textContent === '#1');

  // Refresh address of the running download by pasting a new link.
  await row(page, 's1.bin').click({ button: 'right' });
  await page.locator('#context-menu').getByRole('menuitem', { name: 'Refresh download address…' }).click();
  await page.locator('#refresh-dialog[open]').waitFor();
  assert.ok(app.manager.refreshState(), 'Opening the dialog arms the refresh');
  await page.locator('#refresh-url').fill(`${origin}/slow/s1.bin?token=fresh`);
  await page.locator('#refresh-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#refresh-dialog').open);
  const s1 = app.manager.jobs.find(job => job.filename === 's1.bin');
  assert.equal(s1.url, `${origin}/slow/s1.bin?token=fresh`); assert.ok(s1.refreshedAt);

  // "After all downloads" choice from the menu, shown in the status bar.
  await page.locator('#menu-tasks').click();
  await page.getByRole('menuitemradio', { name: 'Close ZIVAR' }).click();
  await page.locator('#after-all-status').filter({ hasText: 'Close ZIVAR' }).waitFor();
  assert.equal(app.manager.settings().afterAll, 'quit');
  assert.equal(await page.locator('[data-after="shutdown"]').isVisible(), false, 'Shutdown is a desktop-only option');

  assert.ok(await page.locator('#speed-graph').evaluate(canvas => canvas.width > 0));
  await page.screenshot({ path: path.join(project, 'artifacts', 'features.png') });
  for (const job of app.manager.jobs) if (job.status !== 'completed') await app.manager.action(job.id, 'cancel').catch(() => {});
  assert.deepEqual(errors, [], 'Browser errors');
  console.log('PASS: settings concurrency, batch pattern add, search, checksum verdicts, queue move, refresh address, after-all menu, speed graph.');
} finally {
  await browser?.close(); await app.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(temporaryRoot)) throw new Error('Unsafe features test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
