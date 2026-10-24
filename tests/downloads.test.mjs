import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DownloadManager, safeFilename, normalizeProxy, DEFAULT_BROWSER_DOWNLOAD_TYPES, DEFAULT_BROWSER_DOWNLOAD_SITE_EXCLUSIONS, normalizeBrowserDownloadTypes, normalizeBrowserDownloadSiteExclusions } from '../app/manager.mjs';
import { startServer } from '../app/server.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('browser automatic capture rules normalize IDM types and site exclusions', () => {
  assert.ok(DEFAULT_BROWSER_DOWNLOAD_TYPES.includes('EXE'));
  assert.ok(DEFAULT_BROWSER_DOWNLOAD_TYPES.includes('R0*'));
  assert.ok(DEFAULT_BROWSER_DOWNLOAD_SITE_EXCLUSIONS.includes('*.update.microsoft.com'));
  assert.deepEqual(normalizeBrowserDownloadTypes('.exe, msi R1* invalid/type'), ['EXE', 'MSI', 'R1*']);
  assert.deepEqual(normalizeBrowserDownloadSiteExclusions('*.Example.com\ninvalid/path\nexample.com'), ['*.example.com', 'example.com']);
  assert.deepEqual(normalizeBrowserDownloadTypes(''), []);
  assert.deepEqual(normalizeBrowserDownloadSiteExclusions(''), []);
});

async function until(predicate, timeout = 15000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timeout waiting for condition.'); await wait(15); }
}
async function resources(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-test-'));
  const data = Buffer.alloc(4 * 1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = (i * 13 + (i >> 10)) % 251;
  const fixture = { data, etag: '"version-1"', ranges: [], requests: [], ...options };
  const source = http.createServer((req, res) => {
    fixture.requests.push({ path: req.url, headers: req.headers });
    if (req.url === '/missing') { res.writeHead(404); res.end('missing'); return; }
    if (req.url === '/stream.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U'); return; }
    if (req.url === '/broken-range' && req.headers.range !== 'bytes=0-0') { res.writeHead(206, { 'Content-Range': 'bytes 1-3/4' }); res.end('bad'); return; }
    if (req.url === '/redirect') { res.writeHead(302, { Location: fixture.redirect }); res.end(); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="test-file.bin"');
    if (!fixture.noValidator) res.setHeader('ETag', fixture.etag);
    const range = !fixture.noRange && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Number(range[2]) : fixture.data.length - 1;
    fixture.ranges.push(req.headers.range || 'full');
    if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fixture.data.length}`, 'Content-Length': end - start + 1 });
    else if (!fixture.unknownLength) res.setHeader('Content-Length', fixture.data.length);
    let offset = start;
    const timer = setInterval(() => {
      if (offset > end) { clearInterval(timer); res.end(); return; }
      const next = Math.min(end + 1, offset + 16 * 1024); res.write(fixture.data.subarray(offset, next)); offset = next;
    }, fixture.delay || 2);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const manager = await new DownloadManager({ dataDirectory: path.join(directory, 'state'), downloadDirectory: path.join(directory, 'downloads') }).init();
  t.after(async () => {
    await manager.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
    const resolved = path.resolve(directory);
    // Only recursively remove the exact temporary directory created by this test.
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('zivar-test-')) throw new Error('Unsafe test cleanup path');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, fixture, manager, source, url: `http://127.0.0.1:${source.address().port}` };
}
async function finished(manager, id) {
  await until(() => ['completed', 'error'].includes(manager.jobs.find(job => job.id === id)?.status));
  const job = manager.jobs.find(item => item.id === id);
  assert.equal(job.status, 'completed', job.error); return job;
}

test('parallel HTTP Range produces an exact file and never overwrites an existing file', async t => {
  const { manager, fixture, url } = await resources(t);
  await fs.writeFile(path.join(manager.downloadDirectory, 'test-file.bin'), 'existing file');
  const added = await manager.add({ url: url + '/file' });
  const job = await finished(manager, added.id);
  assert.equal(job.connectionCount, 4);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
  assert.equal(await fs.readFile(path.join(manager.downloadDirectory, 'test-file.bin'), 'utf8'), 'existing file');
  assert.equal(job.filename, 'test-file (1).bin');
  assert.ok(fixture.ranges.length >= 5);
});

test('pause and resume request only remaining bytes', async t => {
  const { manager, fixture, url } = await resources(t, { delay: 7 });
  const added = await manager.add({ url: url + '/file' });
  const job = manager.jobs.find(item => item.id === added.id);
  await until(() => job.received > 200000);
  await manager.action(job.id, 'pause'); await until(() => job.status === 'paused');
  const received = job.received; assert.ok(received > 0 && received < fixture.data.length);
  const before = fixture.ranges.length;
  await manager.action(job.id, 'resume'); await finished(manager, job.id);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
  const remainingRanges = fixture.ranges.slice(before).filter(value => value !== 'bytes=0-0');
  assert.ok(remainingRanges.every(value => Number(/bytes=(\d+)/.exec(value)[1]) % (1024 * 1024) > 0));
});

test('changed ETag resets partial data instead of mixing file versions', async t => {
  const { manager, fixture, url } = await resources(t, { delay: 5 });
  const added = await manager.add({ url: url + '/file' }); const job = manager.jobs.find(item => item.id === added.id);
  await until(() => job.received > 150000);
  await manager.action(job.id, 'pause'); await until(() => job.status === 'paused');
  fixture.data = Buffer.alloc(fixture.data.length, 123); fixture.etag = '"version-2"';
  await manager.action(job.id, 'resume'); await finished(manager, job.id);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
});

test('servers without Range support or Content-Length download through one connection', async t => {
  const { manager, fixture, url } = await resources(t, { noRange: true, noValidator: true, unknownLength: true });
  const added = await manager.add({ url: url + '/file' }); const job = await finished(manager, added.id);
  assert.equal(job.connectionCount, 1); assert.equal(job.total, null);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
});

test('a paused queue survives application restart and resumes from disk', async t => {
  const { manager, fixture, url } = await resources(t, { delay: 5 });
  const added = await manager.add({ url: url + '/file', headers: { cookie: 'private=session' } });
  await until(() => manager.jobs[0].received > 100000);
  await manager.close();
  const persisted = await fs.readFile(path.join(manager.dataDirectory, 'jobs.json'), 'utf8');
  assert.ok(!persisted.includes('private=session'));
  const restored = await new DownloadManager({ dataDirectory: manager.dataDirectory, downloadDirectory: manager.downloadDirectory }).init();
  t.after(() => restored.close());
  assert.equal(restored.jobs[0].status, 'paused');
  await restored.action(added.id, 'resume'); const job = await finished(restored, added.id);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
  await restored.close();
});

test('cross-origin redirects strip browser session credentials', async t => {
  const first = await resources(t), second = await resources(t);
  first.fixture.redirect = second.url + '/file';
  const added = await first.manager.add({ url: first.url + '/redirect', headers: { cookie: 'secret=1', authorization: 'Bearer private', origin: first.url, referer: 'https://private.example/watch?token=1' } });
  await finished(first.manager, added.id);
  assert.ok(first.fixture.requests.some(req => req.headers.cookie === 'secret=1'));
  assert.ok(second.fixture.requests.every(req => !req.headers.cookie && !req.headers.authorization && !req.headers.origin && !req.headers.referer));
});

test('HTTP errors and malformed ranges never publish corrupt output', async t => {
  const { manager, url } = await resources(t);
  for (const route of ['/missing', '/broken-range']) {
    const added = await manager.add({ url: url + route });
    await until(() => manager.jobs.find(job => job.id === added.id).status === 'error');
  }
  assert.deepEqual(await fs.readdir(manager.downloadDirectory), []);
  await assert.rejects(() => manager.add({ url: url + '/stream.m3u8' }), /HLS\/DASH/);
});

test('API rejects unauthenticated requests, foreign origins, and unsafe URL schemes', async t => {
  const { directory } = await resources(t);
  const app = await startServer({ port: 0, dataDirectory: path.join(directory, 'api-state'), downloadDirectory: path.join(directory, 'api-output') });
  t.after(() => app.close());
  try {
    assert.equal((await fetch(app.origin + '/api/state')).status, 401);
    assert.equal((await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}`, Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } })).status, 200);
    assert.equal((await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } }).then(res => res.json())).browserIntegration.connected, false);
    await fetch(app.origin + '/api/state', { headers: { 'X-Zivar-Client': 'extension' } });
    assert.equal((await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } }).then(res => res.json())).browserIntegration.connected, false);
    await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}`, 'X-Zivar-Client': 'extension' } });
    assert.equal((await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } }).then(res => res.json())).browserIntegration.connected, true);
    const result = await fetch(app.origin + '/api/downloads', { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'file:///C:/Windows/system.ini' }) });
    assert.equal(result.status, 400);
    const page = await fetch(app.origin); assert.equal(page.status, 200); assert.ok((await page.text()).includes('ZIVAR'));
  } finally { await app.close(); }
});

test('Windows filenames are kept inside the selected output folder', () => {
  assert.equal(safeFilename('../../CON.txt'), '.._.._CON.txt');
  assert.equal(safeFilename('CON.txt'), '_CON.txt');
  assert.equal(safeFilename(' report.zip. '), 'report.zip');
  assert.equal(safeFilename(''), 'download');
  assert.ok(!/[\\/:]/.test(safeFilename('C:\\Windows\\test.txt')));
});

test('the queue limits simultaneous jobs and cancellation stops queued/active transfers', async t => {
  const { manager, fixture, url } = await resources(t, { delay: 5 });
  const jobs = [];
  let maximum = 0;
  manager.on('change', () => { maximum = Math.max(maximum, manager.active.size); });
  for (let index = 0; index < 5; index++) jobs.push(await manager.add({ url: `${url}/file?index=${index}` }));
  assert.equal(manager.active.size, 3);
  await manager.action(jobs[4].id, 'cancel');
  await manager.action(jobs[0].id, 'cancel');
  await until(() => manager.jobs.every(job => ['completed', 'cancelled'].includes(job.status)));
  assert.equal(manager.jobs.find(job => job.id === jobs[0].id).status, 'cancelled');
  assert.equal(manager.jobs.find(job => job.id === jobs[4].id).status, 'cancelled');
  assert.ok(!fixture.requests.some(req => req.path.endsWith('index=4')));
  assert.ok(maximum <= 3);
  assert.equal((await fs.readdir(manager.downloadDirectory)).length, 3);
});

test('without a validator, resuming starts fresh instead of appending unverified bytes', async t => {
  const { manager, fixture, url } = await resources(t, { noValidator: true, delay: 2 });
  const added = await manager.add({ url: url + '/file' }); const job = manager.jobs.find(item => item.id === added.id);
  await until(() => job.received > 100000);
  await manager.action(job.id, 'pause'); await until(() => job.status === 'paused');
  fixture.data = Buffer.alloc(fixture.data.length, 119);
  await manager.action(job.id, 'resume'); await finished(manager, job.id);
  assert.equal(job.connectionCount, 1);
  assert.equal(hash(await fs.readFile(job.outputPath)), hash(fixture.data));
  assert.equal(fixture.ranges.filter(value => value === 'full').length, 2);
});

test('browser-assisted job: ordered chunks, conflict resync, pause stops uploads, queue never runs it, exact output', async t => {
  const { manager, fixture } = await resources(t);
  const data = fixture.data, half = data.length / 2;
  const job = await manager.addBrowser({ filename: 'from-chrome.bin', parts: [{ key: 'file', url: 'https://cdn.example/video.bin' }], pageUrl: 'https://site.example/watch/1' });
  assert.equal(job.status, 'downloading');
  const wrong = await manager.browserChunk(job.id, { key: 'file', offset: 100, total: data.length }, data.subarray(100, 200));
  assert.equal(wrong.conflict, true); assert.equal(wrong.parts[0].received, 0, 'A chunk at the wrong offset must not be written');
  let state = await manager.browserChunk(job.id, { key: 'file', offset: 0, total: data.length }, data.subarray(0, half));
  assert.equal(state.parts[0].received, half);
  await manager.action(job.id, 'pause');
  state = await manager.browserChunk(job.id, { key: 'file', offset: half, total: data.length }, data.subarray(half));
  assert.equal(state.status, 'paused'); assert.equal(state.parts[0].received, half, 'Paused job must not accept data');
  await manager.action(job.id, 'resume');
  await wait(100); assert.equal(manager.jobs.find(item => item.id === job.id).status, 'queued', 'The app queue must not try to download browser jobs itself');
  await assert.rejects(manager.browserFinish(job.id), /belum lengkap/);
  await assert.rejects(manager.browserChunk(job.id, { key: 'file', offset: half, total: data.length + 1 }, data.subarray(half)), /berubah/);
  await manager.browserChunk(job.id, { key: 'file', offset: half, total: data.length }, data.subarray(half));
  const finishing = manager.browserFinish(job.id);
  assert.equal(typeof manager.active.get(job.id)?.promise?.then, 'function', 'Browser assembly must be tracked by the active job');
  await finishing;
  const done = await finished(manager, job.id);
  assert.equal(hash(await fs.readFile(done.outputPath)), hash(data)); assert.equal(done.filename, 'from-chrome.bin');
});

test('browser job API needs the pairing token and accepts raw binary chunks', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-test-'));
  const app = await startServer({ port: 0, dataDirectory: path.join(directory, 'state'), downloadDirectory: path.join(directory, 'downloads') });
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const call = (route, options = {}) => fetch(app.origin + route, { method: 'POST', ...options, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', ...options.headers } });
  const created = await (await call('/api/browser-jobs', { body: JSON.stringify({ filename: 'a.bin', parts: [{ key: 'file', url: 'https://cdn.example/a.bin' }] }) })).json();
  const bytes = Buffer.from('hello browser download');
  assert.equal((await fetch(`${app.origin}/api/browser-jobs/${created.id}/chunk?part=file&offset=0`, { method: 'POST', body: bytes })).status, 401);
  const chunk = await (await call(`/api/browser-jobs/${created.id}/chunk?part=file&offset=0&total=${bytes.length}`, { headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
  assert.equal(chunk.parts[0].received, bytes.length);
  await call(`/api/browser-jobs/${created.id}/finish`, { body: '{}' });
  await until(() => app.manager.jobs[0].status === 'completed');
  assert.deepEqual(await fs.readFile(app.manager.jobs[0].outputPath), bytes);
  const bad = async () => (await (await call('/api/browser-jobs', { body: JSON.stringify({ parts: [{ key: 'evil', url: 'https://x.example/' }] }) })).json()).error;
  assert.equal(await bad(), 'The browser download file type is invalid.', 'English is the default language');
  await call('/api/settings', { body: JSON.stringify({ language: 'id' }) });
  assert.equal(await bad(), 'Jenis file unduhan browser tidak valid.', 'Indonesian messages come through untouched');
});

test('settings control simultaneous downloads; queue order can be changed with move', async t => {
  const { manager, url } = await resources(t, { delay: 25 });
  await manager.updateSettings({ concurrency: 1, connections: 2 });
  assert.equal(manager.concurrency, 1); assert.equal(manager.connections, 2);
  const first = await manager.add({ url: `${url}/one.bin` });
  const second = await manager.add({ url: `${url}/two.bin` });
  const third = await manager.add({ url: `${url}/three.bin` });
  await until(() => manager.jobs.find(job => job.id === first.id).status === 'downloading');
  assert.equal(manager.active.size, 1, 'Only one download may run when concurrency is 1');
  const moved = await manager.moveQueue(third.id, 'top');
  assert.deepEqual(moved.order, [third.id, second.id]);
  await assert.rejects(manager.moveQueue(first.id, 'up'), /Antrean/);
  await manager.action(first.id, 'cancel');
  await until(() => manager.jobs.find(job => job.id === third.id).status === 'downloading');
  assert.equal(manager.jobs.find(job => job.id === second.id).status, 'queued', 'The job moved to the top must start first');
  await until(() => manager.jobs.find(job => job.id === third.id).parts.length > 0);
  await until(() => manager.jobs.find(job => job.id === third.id).connectionCount === 2);
  assert.equal(manager.jobs.find(job => job.id === third.id).connectionCount, 2, 'New jobs use the configured connection count');
});

test('refresh address: a new link continues the same job from where it stopped; a different file is refused', async t => {
  const { manager, url, fixture } = await resources(t, { delay: 20 });
  const job = await manager.add({ url: `${url}/file.bin?token=old` });
  await until(() => manager.jobs[0].received > 256 * 1024);
  await manager.action(job.id, 'pause');
  await until(() => manager.jobs[0].status === 'paused');
  const before = manager.jobs[0].received;
  assert.equal(manager.armRefresh(job.id).id, job.id);
  fixture.delay = 1;
  const refreshed = await manager.add({ url: `${url}/file.bin?token=new` });
  assert.equal(refreshed.id, job.id); assert.equal(refreshed.refreshed, true);
  assert.equal(manager.jobs.length, 1, 'A refresh must not create a second job');
  assert.equal(manager.refreshState(), null);
  const done = await finished(manager, job.id);
  assert.equal(done.url, `${url}/file.bin?token=new`);
  assert.equal(hash(await fs.readFile(done.outputPath)), hash(fixture.data));
  assert.ok(fixture.requests.some(request => request.path.endsWith('token=new') && /^bytes=[1-9]/.test(request.headers.range || '')), `Resumed range expected after ${before} bytes`);

  const other = await manager.add({ url: `${url}/other.bin?x=1` });
  await manager.action(other.id, 'pause');
  await until(() => ['paused', 'completed'].includes(manager.jobs.find(item => item.id === other.id).status));
  const stored = manager.jobs.find(item => item.id === other.id);
  if (stored.status === 'paused') {
    stored.total = 12345;
    await manager.refreshAddress(other.id, { url: `${url}/other.bin?x=2` });
    await until(() => stored.status === 'error');
    assert.match(stored.error, /file yang berbeda/);
  }
});

test('checksum of a finished file and proxy address validation', async t => {
  const { manager, url, fixture } = await resources(t);
  const job = await manager.add({ url: `${url}/sum.bin` });
  await finished(manager, job.id);
  assert.equal((await manager.checksum(job.id, 'sha256')).hash, hash(fixture.data));
  await assert.rejects(manager.checksum(job.id, 'crc'), /tidak didukung/);
  assert.equal(normalizeProxy('10.0.0.5:3128'), 'http://10.0.0.5:3128');
  assert.equal(normalizeProxy('https://u:p@proxy.local:8443/'), 'https://u:p@proxy.local:8443');
  for (const bad of ['proxy.local', 'socks5://x:1', 'http://x', 'http://a b:1']) assert.equal(normalizeProxy(bad), '');
  await assert.rejects(manager.updateSettings({ proxy: 'not a proxy' }), /proxy tidak valid/);
  assert.equal((await manager.updateSettings({ proxy: '' })).proxy, '');
});
