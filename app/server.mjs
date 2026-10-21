import { inspectYoutube, inspectPlaylist, useExtractorDirectory, extractorVersion, updateExtractor } from './youtube.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DownloadManager, CATEGORIES } from './manager.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req, limit = 64 * 1024) {
  const chunks = []; let size = 0;
  for await (const bytes of req) {
    size += bytes.length;
    if (size > limit) throw new Error('Request terlalu besar.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
// Binary chunk uploads from the extension (browser-assisted downloads).
async function raw(req, limit = 16 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const bytes of req) {
    size += bytes.length;
    if (size > limit) throw new Error('Potongan data terlalu besar.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
const integer = value => /^\d{1,15}$/.test(value || '') ? Number(value) : null;
const equals =(a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startServer({ port = 18765, dataDirectory = path.join(project, '.data'), downloadDirectory = path.join(project, 'downloads'), onFocus = null, extractorUpdates = false } = {}) {
  await fs.mkdir(dataDirectory, { recursive: true });
  // Single source of truth for the version: package.json.
  const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  let token;
  try {
    token = (await fs.readFile(path.join(dataDirectory, 'token'), 'utf8')).trim();
    if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('Token lokal tidak valid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    token = randomBytes(24).toString('hex');
    await fs.writeFile(path.join(dataDirectory, 'token'), token, { mode: 0o600 });
  }
  const manager = await new DownloadManager({ dataDirectory, downloadDirectory }).init();
  manager.on('storage-error', error => console.error('Gagal menyimpan antrean:', error.message));
  // YouTube extractor: an updatable copy in the data folder, checked weekly when enabled.
  const extractor = { version: null, checking: false, lastCheck: null, lastResult: null };
  if (extractorUpdates) useExtractorDirectory(path.join(dataDirectory, 'yt-dlp'));
  const extractorFile = path.join(dataDirectory, 'extractor.json');
  try { Object.assign(extractor, JSON.parse(await fs.readFile(extractorFile, 'utf8'))); } catch {}
  extractorVersion().then(version => { extractor.version = version; });
  async function runExtractorUpdate() {
    if (!extractorUpdates) throw new Error('Pembaruan extractor hanya tersedia di aplikasi ZIVAR.');
    if (extractor.checking) return extractor;
    extractor.checking = true;
    try {
      const result = await updateExtractor();
      Object.assign(extractor, { version: result.after, lastResult: result.updated ? `Diperbarui ${result.before} → ${result.after}` : `Sudah versi terbaru (${result.after})` });
    } catch (error) { extractor.lastResult = `Gagal memeriksa pembaruan: ${error.message}`; }
    finally {
      extractor.checking = false; extractor.lastCheck = new Date().toISOString();
      await fs.writeFile(extractorFile, JSON.stringify({ lastCheck: extractor.lastCheck, lastResult: extractor.lastResult })).catch(() => {});
    }
    return extractor;
  }
  const weekly = () => { if (extractorUpdates && manager.settings().autoUpdateExtractor && (!extractor.lastCheck || Date.now() - Date.parse(extractor.lastCheck) > 7 * 86400_000)) runExtractorUpdate().catch(() => {}); };
  const extractorTimer = setTimeout(weekly, 45_000); extractorTimer.unref?.();
  const extractorInterval = setInterval(weekly, 6 * 3600_000); extractorInterval.unref?.();
  let origin, extensionLastSeen = null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Host tidak diizinkan. Gunakan alamat 127.0.0.1 aplikasi.' });
      const caller = req.headers.origin;
      // Chrome/Edge extension IDs, or a Firefox extension's per-install UUID.
      const extension = typeof caller === 'string' && /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(caller);
      if (caller && caller !== origin && !extension) return json(res, 403, { error: 'Origin tidak diizinkan.' });
      if (extension) {
        res.setHeader('Access-Control-Allow-Origin', caller);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Zivar-Client');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204); return res.end();
      }
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!equals(req.headers.authorization, `Bearer ${token}`)) return json(res, 401, { error: 'Kode pairing tidak cocok. Salin ulang dari aplikasi lokal.' });
        if (extension || req.headers['x-zivar-client'] === 'extension') extensionLastSeen = Date.now();
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { jobs: manager.list(), downloadDirectory, concurrency: manager.concurrency, connections: manager.connections, settings: manager.settings(), categories: CATEGORIES, version, refreshPending: manager.refreshState(), desktopFeatures: Boolean(onFocus), browserIntegration: { connected: extensionLastSeen !== null && Date.now() - extensionLastSeen < 300000, lastSeenAt: extensionLastSeen } });
        if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, 200, manager.settings());
        if (req.method === 'POST' && url.pathname === '/api/settings') return json(res, 200, await manager.updateSettings(await body(req)));
        if (req.method === 'POST' && url.pathname === '/api/focus') { onFocus?.(); return json(res, 200, { desktop: Boolean(onFocus) }); }
        if (req.method === 'POST' && url.pathname === '/api/downloads') return json(res, 201, await manager.add(await body(req)));
        // Many links at once (pasted list or a pattern like file[001-100].jpg expanded by the page).
        if (req.method === 'POST' && url.pathname === '/api/downloads/batch') {
          const { items = [] } = await body(req, 2 * 1024 * 1024);
          if (!Array.isArray(items) || !items.length || items.length > 1000) throw new Error('Daftar tautan harus berisi 1–1000 item.');
          const results = [];
          for (const item of items) { try { results.push({ ok: true, id: (await manager.add(item)).id }); } catch (error) { results.push({ ok: false, url: String(item?.url || '').slice(0, 300), error: error.message }); } }
          return json(res, 200, { added: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok) });
        }
        if (req.method === 'POST' && url.pathname === '/api/youtube/formats') return json(res, 200, await inspectYoutube((await body(req)).url));
        if (req.method === 'POST' && url.pathname === '/api/youtube/playlist') return json(res, 200, await inspectPlaylist((await body(req)).url));
        if (req.method === 'GET' && url.pathname === '/api/extractor') return json(res, 200, { ...extractor, available: extractorUpdates });
        if (req.method === 'POST' && url.pathname === '/api/extractor/update') return json(res, 200, { ...await runExtractorUpdate(), available: extractorUpdates });
        if (req.method === 'POST' && url.pathname === '/api/media') return json(res, 201, await manager.addMedia(await body(req)));
        if (req.method === 'POST' && url.pathname === '/api/grabber') return json(res, 200, await manager.grabSite(await body(req)));
        if (req.method === 'POST' && url.pathname === '/api/probe') return json(res, 200, await manager.probeAccess(await body(req)));
        if (req.method === 'POST' && url.pathname === '/api/browser-jobs') return json(res, 201, await manager.addBrowser(await body(req)));
        const browser = /^\/api\/browser-jobs\/([a-f0-9-]{36})(?:\/(chunk|finish|fail))?$/.exec(url.pathname);
        if (browser && req.method === 'GET' && !browser[2]) return json(res, 200, manager.browserState(manager.browserJob(browser[1])));
        if (browser && req.method === 'POST' && browser[2] === 'chunk') {
          const offset = integer(url.searchParams.get('offset'));
          if (offset === null) throw new Error('Offset tidak valid.');
          return json(res, 200, await manager.browserChunk(browser[1], { key: url.searchParams.get('part'), offset, total: integer(url.searchParams.get('total')), restart: url.searchParams.get('restart') === '1' }, await raw(req)));
        }
        if (browser && req.method === 'POST' && browser[2] === 'finish') return json(res, 200, await manager.browserFinish(browser[1]));
        if (browser && req.method === 'POST' && browser[2] === 'fail') return json(res, 200, await manager.browserFail(browser[1], (await body(req)).error));
        const action = /^\/api\/downloads\/([a-f0-9-]{36})\/(pause|resume|cancel|remove|move|refresh|checksum)$/.exec(url.pathname);
        if (req.method === 'POST' && action) {
          const [, id, verb] = action;
          if (verb === 'remove') return json(res, 200, await manager.remove(id));
          if (verb === 'move') return json(res, 200, await manager.moveQueue(id, (await body(req)).direction));
          if (verb === 'checksum') return json(res, 200, await manager.checksum(id, (await body(req)).algorithm));
          if (verb === 'refresh') { const input = await body(req); return json(res, 200, input.url ? await manager.refreshAddress(id, input) : { pending: manager.armRefresh(id) }); }
          return json(res, 200, await manager.action(id, verb));
        }
        if (req.method === 'POST' && url.pathname === '/api/refresh/cancel') return json(res, 200, { pending: manager.cancelRefresh() });
        if (req.method === 'POST' && url.pathname === '/api/open-folder') {
          if (process.platform === 'win32') {
            const child = spawn('explorer.exe', [downloadDirectory], { detached: true, stdio: 'ignore', windowsHide: true });
            child.on('error', error => console.error('Tidak dapat membuka folder:', error.message)); child.unref();
          }
          return json(res, 200, { path: downloadDirectory });
        }
        return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Metode tidak didukung.' });
      const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
      const filename = files[url.pathname];
      if (!filename) return json(res, 404, { error: 'Halaman tidak ditemukan.' });
      let contents = await fs.readFile(path.join(project, 'app', 'public', filename));
      if (filename === 'index.html') contents = Buffer.from(contents.toString().replace('__PAIRING_TOKEN__', token));
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] }); res.end(contents);
    } catch (error) {
      if (!res.headersSent) json(res, 400, { error: error.message }); else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closePromise;
  return { server, manager, token, origin, close() {
    closePromise ||= (async () => {
      clearTimeout(extractorTimer); clearInterval(extractorInterval);
      await manager.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    })();
    return closePromise;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await startServer({ port: Number(process.env.ZIVAR_PORT || 18765), extractorUpdates: true });
    console.log(`\nZIVAR Download Manager\nBuka ${app.origin}\nHasil unduhan: ${app.manager.downloadDirectory}\nTekan Ctrl+C untuk berhenti.\n`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? 'Aplikasi sudah berjalan atau port 18765 sedang dipakai.' : error.message); process.exitCode = 1; }
}



