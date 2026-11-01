import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DownloadManager } from '../app/manager.mjs';
import { startServer } from '../app/server.mjs';
import { listNetworks, selectNetworks, normalizeNetworkSelection, isNetworkFailure } from '../app/network.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function until(predicate, timeout = 20000) {
  const start = Date.now();
  while (!await predicate()) { if (Date.now() - start > timeout) throw new Error('Timeout waiting for condition.'); await wait(20); }
}

test('adapters are listed without loopback, link-local or virtual ones in the default selection', () => {
  const entry = (address, family = 'IPv4', mac = 'aa:bb:cc:dd:ee:01', internal = false) => ({ address, family, mac, internal });
  const networks = listNetworks({ interfaces: {
    'Wi-Fi': [entry('fe80::1', 'IPv6'), entry('192.168.1.10')],
    'Ethernet 2': [entry('10.0.0.5', 'IPv4', 'aa:bb:cc:dd:ee:02')],
    'vEthernet (Default Switch)': [entry('172.23.0.1', 'IPv4', '00:15:5d:92:de:b7')],
    'Loopback Pseudo-Interface 1': [entry('127.0.0.1', 'IPv4', '00:00:00:00:00:00', true)],
    'Isolated': [entry('169.254.3.4')],
    'IPv6 only': [entry('2001:db8::5', 'IPv6')],
  } });
  assert.deepEqual(networks.map(network => network.id), ['Ethernet 2', 'IPv6 only', 'Wi-Fi', 'vEthernet (Default Switch)']);
  assert.equal(networks.find(network => network.id === 'Wi-Fi').address, '192.168.1.10', 'IPv4 is preferred');
  assert.equal(networks.find(network => network.id === 'Wi-Fi').kind, 'wifi');
  assert.equal(networks.find(network => network.id === 'IPv6 only').family, 6);
  assert.equal(networks.find(network => network.id === 'vEthernet (Default Switch)').virtual, true);
  assert.deepEqual(selectNetworks(networks, null).map(network => network.id), ['Ethernet 2', 'IPv6 only', 'Wi-Fi']);
  assert.deepEqual(selectNetworks(networks, ['Wi-Fi', 'vEthernet (Default Switch)']).map(network => network.id), ['Wi-Fi', 'vEthernet (Default Switch)']);
  assert.equal(normalizeNetworkSelection('x'), null);
  assert.deepEqual(normalizeNetworkSelection(['a', ' a ', '', 'b']), ['a', 'b']);
});

test('network failures are told apart from server errors', () => {
  assert.equal(isNetworkFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), true);
  assert.equal(isNetworkFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) })), true);
  assert.equal(isNetworkFailure(Object.assign(new Error('silence'), { network: true })), true);
  assert.equal(isNetworkFailure(new Error('HTTP 403')), false);
});

// Two logical networks on this computer. Both can be the same loopback address (macOS only has 127.0.0.1),
// so the tests check what the manager reports per network rather than the source address the server sees.
async function setup(t, { size = 24 * 1024 * 1024, networks, dropFor = null, delayFor = {}, settings = { multiNetwork: true }, checkTimeout = 3000 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-net-'));
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7 + (i >> 11)) % 253;
  const requests = [];
  const source = http.createServer((req, res) => {
    const from = req.socket.remoteAddress.replace('::ffff:', '');
    requests.push({ range: req.headers.range, from });
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : size - 1;
    // The test can make one source address fail in the middle of a chunk, like an unplugged adapter.
    if (dropFor && from === dropFor && start > 0) { res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }); res.write(data.subarray(start, start + 1024)); setTimeout(() => res.socket.destroy(), 30); return; }
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('ETag', '"v1"'); res.setHeader('Content-Disposition', 'attachment; filename="big.bin"');
    if (range) res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }); else res.setHeader('Content-Length', size);
    let offset = start;
    const pace = delayFor[from] ?? 1;
    const timer = setInterval(() => { if (offset > end) { clearInterval(timer); res.end(); return; } const next = Math.min(end + 1, offset + 64 * 1024); res.write(data.subarray(offset, next)); offset = next; }, pace);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const manager = await new DownloadManager({ dataDirectory: path.join(directory, 'state'), downloadDirectory: path.join(directory, 'downloads'), connections: 2, networkProvider: () => networks, networkCheckTimeout: checkTimeout }).init();
  await manager.updateSettings(settings);
  t.after(async () => { await manager.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve)); if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())) await fs.rm(directory, { recursive: true, force: true }); });
  return { manager, data, requests, url: `http://127.0.0.1:${source.address().port}/big.bin`, directory };
}
const net = (id, address = '127.0.0.1') => ({ id, name: id, address, family: 4, kind: 'other', virtual: false });
const done = async (manager, id) => { await until(() => ['completed', 'error'].includes(manager.jobs.find(job => job.id === id).status)); return manager.jobs.find(job => job.id === id); };
const loopbackAlias = os.platform() === 'darwin' ? '127.0.0.1' : '127.0.0.2';

test('a download is shared between two networks and the file is byte-exact', async t => {
  const { manager, data, requests, url } = await setup(t, { networks: [net('Wi-Fi'), net('Ethernet', loopbackAlias)] });
  const job = await done(manager, (await manager.add({ url })).id);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(sha(await fs.readFile(job.outputPath)), sha(data));
  assert.equal(job.networks.length, 2);
  assert.ok(job.networks.every(entry => entry.state === 'active' && entry.received > 2 * 1024 * 1024), `both networks carry data: ${JSON.stringify(job.networks)}`);
  assert.equal(job.networks.reduce((sum, entry) => sum + entry.received, 0), data.length);
  assert.ok(job.parts.length > 4, 'the file is cut into small chunks');
  if (loopbackAlias !== '127.0.0.1') assert.ok(requests.some(request => request.from === '127.0.0.1') && requests.some(request => request.from === loopbackAlias), 'connections really leave from each network address');
});

test('a faster network takes more of the file', { skip: loopbackAlias === '127.0.0.1' && 'needs two distinct loopback addresses' }, async t => {
  // The server answers the second address slowly, so its network should end up with the smaller share.
  const { manager, url } = await setup(t, { networks: [net('Fast'), net('Slow', loopbackAlias)], delayFor: { [loopbackAlias]: 120 }, size: 24 * 1024 * 1024 });
  const job = await done(manager, (await manager.add({ url })).id);
  assert.equal(job.status, 'completed', job.error);
  const fast = job.networks.find(entry => entry.id === 'Fast').received, slow = job.networks.find(entry => entry.id === 'Slow').received;
  assert.equal(fast + slow, job.total);
  assert.ok(fast > slow * 2, `the fast network carried ${fast} bytes against ${slow}`);
});

test('a network that cannot reach the server is left out before the download starts', async t => {
  // 192.0.2.1 belongs to no adapter, so binding to it fails at once.
  const { manager, data, url } = await setup(t, { networks: [net('Wi-Fi'), net('Broken', '192.0.2.1'), net('Ethernet', loopbackAlias)] });
  const job = await done(manager, (await manager.add({ url })).id);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(sha(await fs.readFile(job.outputPath)), sha(data));
  assert.equal(job.networks.find(entry => entry.id === 'Broken').state, 'unavailable');
  assert.deepEqual(job.networks.filter(entry => entry.state === 'active').map(entry => entry.id).sort(), ['Ethernet', 'Wi-Fi']);
});

test('with only one working network the download uses the normal path', async t => {
  const { manager, data, url } = await setup(t, { networks: [net('Wi-Fi'), net('Broken', '192.0.2.1')] });
  const job = await done(manager, (await manager.add({ url })).id);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(sha(await fs.readFile(job.outputPath)), sha(data));
  assert.equal(job.networkNote, 'one-network');
  assert.equal(job.parts.length, 2, 'the usual two connections, not many chunks');
});

test('a network that drops out mid-download hands its chunks to the other one', { skip: loopbackAlias === '127.0.0.1' && 'needs two distinct loopback addresses' }, async t => {
  const { manager, data, url } = await setup(t, { networks: [net('Wi-Fi'), net('Phone', loopbackAlias)], dropFor: loopbackAlias });
  const job = await done(manager, (await manager.add({ url })).id);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(sha(await fs.readFile(job.outputPath)), sha(data));
  assert.equal(job.networks.find(entry => entry.id === 'Phone').state, 'failed');
  assert.equal(job.networks.find(entry => entry.id === 'Wi-Fi').state, 'active');
});

test('multi-network is off by default and can be chosen per download', async t => {
  const { manager, url } = await setup(t, { networks: [net('Wi-Fi'), net('Ethernet', loopbackAlias)], settings: {} });
  const plain = await done(manager, (await manager.add({ url })).id);
  assert.equal(plain.networks, undefined, 'off by default');
  assert.equal(plain.parts.length, 2);
  await manager.remove?.(plain.id).catch(() => {});
  const chosen = await done(manager, (await manager.add({ url: url + '?again=1', multiNetwork: true })).id);
  assert.equal(chosen.networks?.length, 2, 'a download can ask for it');
  assert.equal(manager.settings().multiNetwork, false);
});

test('a proxy turns multi-network off and says why', async t => {
  const { manager, url } = await setup(t, { networks: [net('Wi-Fi'), net('Ethernet', loopbackAlias)], settings: { multiNetwork: true, proxy: 'http://127.0.0.1:9' } });
  assert.equal(manager.networkInfo().proxy, true);
  await manager.updateSettings({ proxy: '' });
  assert.equal(manager.networkInfo().proxy, false);
});

test('the API lists networks and inspects a link', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-net-api-'));
  const data = Buffer.alloc(1_500_000, 5);
  const source = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/zip; charset=binary'); res.setHeader('Content-Disposition', 'attachment; filename="pack.zip"');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) { res.writeHead(206, { 'Content-Range': `bytes ${range[1]}-${range[2] || data.length - 1}/${data.length}` }); res.end(data.subarray(Number(range[1]), Number(range[2] || data.length - 1) + 1)); } else { res.setHeader('Content-Length', data.length); res.end(data); }
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const app = await startServer({ port: 0, dataDirectory: path.join(directory, 'state'), downloadDirectory: path.join(directory, 'downloads') });
  t.after(async () => { await app.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const call = (route, body) => fetch(app.origin + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(response => response.json());
  const info = await call('/api/networks');
  assert.ok(Array.isArray(info.networks) && Array.isArray(info.usable) && info.enabled === false);
  const inspected = await call('/api/inspect', { url: `http://127.0.0.1:${source.address().port}/x` });
  assert.deepEqual({ ok: inspected.ok, total: inspected.total, type: inspected.contentType, resumable: inspected.supportsRanges, name: inspected.filename }, { ok: true, total: 1_500_000, type: 'application/zip', resumable: true, name: 'pack.zip' });
  assert.equal((await call('/api/inspect', { url: 'ftp://x/y' })).error !== undefined, true);
});
