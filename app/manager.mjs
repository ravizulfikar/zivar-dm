import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { muxMedia, muxFiles } from './media.mjs';
import { youtubeUrl, downloadYoutube, youtubeOutputExtension, youtubeIsAudio } from './youtube.mjs';

const TERMINAL = new Set(['completed', 'cancelled']);
export const CATEGORIES = ['video', 'audio', 'image', 'document', 'archive', 'program', 'other'];
const CATEGORY_EXTENSIONS = {
  video: new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.flv', '.mpeg', '.mpg', '.ts', '.m3u8', '.mpd']),
  audio: new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tif', '.tiff', '.ico', '.avif']),
  document: new Set(['.pdf', '.txt', '.rtf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.epub']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso']),
  program: new Set(['.exe', '.msi', '.apk', '.dmg', '.deb', '.rpm', '.msix']),
};
const CATEGORY_MIME = [
  ['video', /^video\//], ['audio', /^audio\//], ['image', /^image\//],
  ['document', /pdf|msword|officedocument|text\//], ['archive', /zip|rar|7z|gzip|tar|compressed/],
  ['program', /octet-stream|x-msdownload|x-apple-diskimage/],
];
const allowedCategory = value => CATEGORIES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : null;
export function classifyCategory(filename = '', contentType = '') {
  const mime = String(contentType || '').toLowerCase().split(';')[0];
  // Generic "binary" types say nothing about the file; the extension is more reliable then.
  const generic = !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream';
  if (!generic) for (const [category, pattern] of CATEGORY_MIME) if (pattern.test(mime)) return category;
  let extension = '';
  try { extension = path.extname(new URL(String(filename)).pathname).toLowerCase(); } catch { extension = path.extname(String(filename)).toLowerCase(); }
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) if (extensions.has(extension)) return category;
  return 'other';
}
export function safeFilename(value = 'download') {
  let name = String(value).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || name === '.' || name === '..') name = 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  if (name.length > 160) name = name.slice(0, 140) + path.extname(name).slice(-16);
  return name;
}
export function httpUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Gunakan URL HTTP/HTTPS tanpa username atau password.');
  return url.href;
}
// Accepts "host:port" or http(s)://[user:pass@]host:port; returns a normalized URL or ''.
export function normalizeProxy(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || !url.port || /[\s\r\n]/.test(text)) return '';
    return `${url.protocol}//${url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''}${url.hostname}:${url.port}`;
  } catch { return ''; }
}
function wait(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const finish = callback => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(); };
    const abort = () => finish(() => reject(signal.reason || new Error('Operasi dihentikan.')));
    timer = setTimeout(() => finish(resolve), ms);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function filenameFrom(headers, url) {
  const disposition = headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) { try { return decodeURIComponent(encoded[1]); } catch {} }
  const quoted = /filename="([^"]+)"/i.exec(disposition) || /filename=([^;]+)/i.exec(disposition);
  if (quoted) return quoted[1].trim();
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'download'; } catch { return 'download'; }
}
const number = value => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const isStream = type => /mpegurl|dash\+xml|vnd\.mpeg\.dash/.test(type);

// Follow redirects explicitly so session credentials never move to a different origin.
async function request(url, initialHeaders, signal) {
  let current = httpUrl(url), headers = { ...initialHeaders, 'accept-encoding': 'identity' };
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  let timer;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(new Error('Server tidak mengirim data selama 45 detik.')), 45_000); timer.unref?.(); };
  const dispose = () => clearTimeout(timer);
  try {
    for (let redirect = 0; redirect <= 8; redirect++) {
      touch();
      const response = await fetch(current, { headers, signal: combined, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Redirect tidak memiliki alamat tujuan.');
        const next = httpUrl(new URL(location, current).href);
        if (new URL(next).origin !== new URL(current).origin) {
          delete headers.cookie; delete headers.authorization; delete headers.origin;
        }
        current = next;
        continue;
      }
      return { response, url: current, touch, dispose };
    }
    throw new Error('Terlalu banyak redirect.');
  } catch (error) { dispose(); throw error; }
}

export class DownloadManager extends EventEmitter {
  constructor({ dataDirectory, downloadDirectory, concurrency = 3, connections = 4 }) {
    super();
    this.dataDirectory = dataDirectory;
    this.downloadDirectory = downloadDirectory;
    this.concurrency = concurrency;
    this.connections = connections;
    this.jobs = [];
    this.active = new Map();
    this.credentials = new Map();
    this.audioCredentials = new Map();
    this.settingsState = this.normalizeSettings({ concurrency, connections });
    this.refreshPending = null;
    this.throttleNextAt = 0;
    this.saveChain = Promise.resolve();
    this.closing = false;
    this.schedulerTimer = null;
  }
  async init() {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    await fs.mkdir(this.downloadDirectory, { recursive: true });
    await fs.mkdir(path.join(this.dataDirectory, 'parts'), { recursive: true });
    try {
      const jobs = JSON.parse(await fs.readFile(path.join(this.dataDirectory, 'jobs.json'), 'utf8'));
      if (!Array.isArray(jobs)) throw new Error('Format database unduhan tidak valid.');
      this.jobs = jobs.filter(job => /^[a-f0-9-]{36}$/.test(job.id)).map(job => ({
        ...job, filename: safeFilename(job.filename),
        category: allowedCategory(job.category) || (job.kind === 'media' ? 'video' : classifyCategory(job.filename, job.contentType)),
        categoryExplicit: Boolean(job.categoryExplicit),
        status: TERMINAL.has(job.status) ? job.status : 'paused', speed: 0,
        error: TERMINAL.has(job.status) ? job.error : 'Aplikasi dimulai ulang. Klik Lanjut untuk meneruskan.',
      }));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      const settings = JSON.parse(await fs.readFile(path.join(this.dataDirectory, 'settings.json'), 'utf8'));
      this.settingsState = this.normalizeSettings({ concurrency: this.concurrency, connections: this.connections, ...settings });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.applyLimits();
    this.schedulerTimer = setInterval(() => this.scheduleTick(), 1000);
    this.schedulerTimer.unref?.();
    return this;
  }
  list() { return this.jobs.map(job => ({ ...job, parts: undefined })); }
  normalizeSettings(value = {}) {
    const schedule = value?.schedule && typeof value.schedule === 'object' ? value.schedule : {};
    const speedLimit = Number(value.speedLimit);
    const date = input => typeof input === 'string' && input && !Number.isNaN(Date.parse(input)) ? new Date(input).toISOString() : null;
    const range = (input, min, max, fallback) => { const number = Math.floor(Number(input)); return Number.isFinite(number) && number >= min && number <= max ? number : fallback; };
    return {
      speedLimit: Number.isFinite(speedLimit) && speedLimit >= 0 && speedLimit <= 1024 * 1024 * 1024 ? Math.floor(speedLimit) : 0,
      categoryFolders: Boolean(value.categoryFolders), clipboardMonitor: Boolean(value.clipboardMonitor),
      schedule: { enabled: Boolean(schedule.enabled), startAt: date(schedule.startAt), endAt: date(schedule.endAt) },
      concurrency: range(value.concurrency, 1, 10, 3),
      connections: range(value.connections, 1, 16, 4),
      notifications: value.notifications === undefined ? true : Boolean(value.notifications),
      afterAll: ['none', 'quit', 'sleep', 'shutdown'].includes(value.afterAll) ? value.afterAll : 'none',
      proxy: normalizeProxy(value.proxy),
      autoUpdateExtractor: value.autoUpdateExtractor === undefined ? true : Boolean(value.autoUpdateExtractor),
    };
  }
  applyLimits() { this.concurrency = this.settingsState.concurrency; this.connections = this.settingsState.connections; }
  settings() { return JSON.parse(JSON.stringify(this.settingsState)); }
  scheduleOpen(now = Date.now()) {
    const schedule = this.settingsState.schedule;
    if (!schedule.enabled) return true;
    if (schedule.startAt && now < Date.parse(schedule.startAt)) return false;
    if (schedule.endAt && now >= Date.parse(schedule.endAt)) return false;
    return true;
  }
  async saveSettings() {
    const destination = path.join(this.dataDirectory, 'settings.json');
    const snapshot = JSON.stringify(this.settingsState, null, 2);
    await fs.writeFile(destination + '.tmp', snapshot);
    await fs.rename(destination + '.tmp', destination);
  }
  async updateSettings(value = {}) {
    if (value.proxy !== undefined && value.proxy !== '' && value.proxy !== null && !normalizeProxy(value.proxy)) throw new Error('Alamat proxy tidak valid. Contoh: http://192.168.1.10:8080');
    this.settingsState = this.normalizeSettings({ ...this.settingsState, ...value, schedule: { ...this.settingsState.schedule, ...(value.schedule || {}) } });
    this.applyLimits();
    await this.saveSettings();
    this.scheduleTick();
    this.emit('settings', this.settings());
    return this.settings();
  }
  scheduleTick() {
    if (this.closing) return;
    if (!this.scheduleOpen()) {
      for (const [id, entry] of this.active) {
        const job = this.jobs.find(item => item.id === id);
        if (job && ['downloading', 'assembling'].includes(job.status)) { job.status = 'pausing'; entry.controller.abort(new Error('Jadwal unduhan sedang ditutup.')); }
      }
      return;
    }
    this.pump();
  }
  async throttle(bytes, signal, touch = null) {
    const limit = this.settingsState.speedLimit;
    if (!limit || bytes <= 0) return;
    const now = Date.now();
    this.throttleNextAt = Math.max(this.throttleNextAt, now) + (bytes / limit) * 1000;
    let remaining = this.throttleNextAt - now;
    while (remaining > 0) {
      const slice = Math.min(30_000, remaining);
      await wait(slice, signal); touch?.();
      remaining -= slice;
    }
  }
  async persist() {
    const snapshot = JSON.stringify(this.jobs.map(({ speed, ...job }) => job), null, 2);
    const destination = path.join(this.dataDirectory, 'jobs.json');
    const write = this.saveChain.then(async () => {
      await fs.writeFile(destination + '.tmp', snapshot);
      await fs.rename(destination + '.tmp', destination);
    });
    this.saveChain = write.catch(error => { this.emit('storage-error', error); });
    return write;
  }
  changed(job) {
    this.emit('change', job);
    if (!this.saveTimer) this.saveTimer = setTimeout(() => {
      this.saveTimer = null; this.persist().catch(() => {});
    }, 1000);
  }
  async add({ url, filename, headers = {}, category = null, youtubeFormat = null, youtubeSubtitles = false, expectedSha256 = null }) {
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/i.test(String(expectedSha256))) throw new Error('Checksum SHA-256 tidak valid.');
    if (this.closing) throw new Error('Aplikasi sedang berhenti.');
    url = httpUrl(url);
    const youtube = youtubeUrl(url);
    if (youtube) url = youtube;
    // A link sent while "Perbarui alamat" is waiting replaces the old link of that job.
    const refreshTarget = !youtube && this.pendingRefreshFor('http');
    if (refreshTarget) return this.applyHttpRefresh(refreshTarget, { url, headers });
    if (youtubeFormat && !/^[\w-]+(?:\+[\w-]+)?$/.test(youtubeFormat)) throw new Error("Format YouTube tidak valid.");
    if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(url)) throw new Error('Versi ini mendukung file langsung MP4/WebM. HLS/DASH belum didukung.');
    // The same YouTube video may be wanted in several formats (e.g. MP4 and MP3).
    const sameRequest = job => job.url === url && (!youtube || ((job.youtubeFormat || null) === (youtubeFormat || null) && Boolean(job.youtubeSubtitles) === Boolean(youtubeSubtitles)));
    const duplicate = this.jobs.find(job => sameRequest(job) && ['queued', 'downloading', 'pausing', 'assembling'].includes(job.status));
    if (duplicate) return this.list().find(job => job.id === duplicate.id);
    if (this.jobs.length >= 2000) throw new Error('Daftar unduhan penuh (maksimal 2.000).');
    const explicitCategory = allowedCategory(category);
    const job = {
      id: randomUUID(), url, filename: safeFilename(filename || filenameFrom(new Headers(), url)),
      kind: youtube ? "youtube" : undefined, youtubeFormat: youtube ? youtubeFormat : undefined, youtubeSubtitles: youtube ? Boolean(youtubeSubtitles) : undefined,
      category: youtube ? (youtubeIsAudio(youtubeFormat) ? 'audio' : 'video') : explicitCategory || classifyCategory(filename || url), categoryExplicit: Boolean(explicitCategory),
      customFilename: Boolean(filename), status: 'queued', createdAt: new Date().toISOString(),
      received: 0, total: null, speed: 0, parts: [], error: null, etag: null,
      lastModified: null, supportsRanges: false, connectionCount: 1,
      ...(expectedSha256 && !youtube ? { expectedSha256: String(expectedSha256).toLowerCase() } : {}),
    };
    // Secrets remain in memory; they are deliberately excluded from jobs.json.
    const permitted = {};
    for (const [key, value] of Object.entries(headers)) {
      if (['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) permitted[key.toLowerCase()] = value;
    }
    if (youtube) {
      const ext = youtubeOutputExtension(youtubeFormat);
      const base = safeFilename(filename || `YouTube-${new URL(url).searchParams.get("v")}`).replace(/\.(mp4|m4a|mp3|webm|mkv)$/i, '');
      job.filename = safeFilename(`${base}.${ext}`);
    }
    this.credentials.set(job.id, permitted);
    this.jobs.unshift(job);
    try { await this.persist(); } catch (error) { this.jobs = this.jobs.filter(item => item !== job); throw error; }
    this.changed(job); this.pump();
    return this.list().find(item => item.id === job.id);
  }
  async addMedia({ manifestUrl, variantUrl, audioUrl = null, manifestType = 'HLS', filename, metadata = {}, headers = {}, audioHeaders = {} }) {
    if (this.closing) throw new Error('Aplikasi sedang berhenti.');
    if (!variantUrl || !/^https?:\/\//i.test(variantUrl)) throw new Error('URL varian media tidak valid.');
    if (audioUrl && !/^https?:\/\//i.test(audioUrl)) throw new Error('URL audio media tidak valid.');
    const refreshTarget = this.pendingRefreshFor('media');
    if (refreshTarget) {
      await this.stopForRefresh(refreshTarget);
      Object.assign(refreshTarget, { manifestUrl: httpUrl(manifestUrl || variantUrl), variantUrl: httpUrl(variantUrl), inputUrl: httpUrl(variantUrl), audioUrl: audioUrl ? httpUrl(audioUrl) : null, status: 'queued', error: null, refreshedAt: new Date().toISOString() });
      const clean = values => Object.fromEntries(Object.entries(values || {}).filter(([key, value]) => ['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)).map(([key, value]) => [key.toLowerCase(), value]));
      this.credentials.set(refreshTarget.id, clean(headers)); this.audioCredentials.set(refreshTarget.id, clean(audioHeaders));
      this.refreshPending = null;
      await this.persist(); this.changed(refreshTarget); this.pump();
      return { ...this.list().find(item => item.id === refreshTarget.id), refreshed: true };
    }
    const duplicate = this.jobs.find(job => job.kind === 'media' && job.variantUrl === variantUrl && ['queued', 'downloading', 'assembling'].includes(job.status));
    if (duplicate) return this.list().find(job => job.id === duplicate.id);
    if (this.jobs.length >= 2000) throw new Error('Daftar unduhan penuh (maksimal 2.000).');
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
    const codec = typeof metadata.codecs === 'string' ? metadata.codecs.slice(0, 200) : null;
    const base = safeFilename(filename || 'video');
    const job = { id: randomUUID(), kind: 'media', category: 'video', categoryExplicit: true, manifestType: String(manifestType || 'HLS').toUpperCase(), manifestUrl: httpUrl(manifestUrl || variantUrl), variantUrl: httpUrl(variantUrl), audioUrl: audioUrl ? httpUrl(audioUrl) : null, inputUrl: httpUrl(variantUrl), filename: base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`, customFilename: Boolean(filename), mediaWidth: positive(metadata.width), mediaHeight: positive(metadata.height), mediaBitrate: positive(metadata.averageBandwidth || metadata.bandwidth), mediaCodec: codec, mediaSize: positive(metadata.size), mediaSizeEstimated: Boolean(metadata.sizeEstimated), status: 'queued', createdAt: new Date().toISOString(), received: 0, total: null, mediaPosition: 0, mediaDuration: positive(metadata.duration), speed: 0, parts: [], error: null };
    const permitted = {};
    for (const [key, value] of Object.entries(headers)) if (['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) permitted[key.toLowerCase()] = value;
    const permittedAudio = {};
    for (const [key, value] of Object.entries(audioHeaders)) if (['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) permittedAudio[key.toLowerCase()] = value;
    if (!Object.keys(permittedAudio).length && audioUrl && new URL(audioUrl).origin === new URL(variantUrl).origin) Object.assign(permittedAudio, permitted);
    this.credentials.set(job.id, permitted);
    this.audioCredentials.set(job.id, permittedAudio);
    this.jobs.unshift(job);
    try { await this.persist(); } catch (error) { this.jobs = this.jobs.filter(item => item !== job); throw error; }
    this.changed(job); this.pump();
    return this.list().find(item => item.id === job.id);
  }
  async grabSite({ url, depth = 1, maxFiles = 100, extensions = [], headers = {} } = {}) {
    const start = httpUrl(url);
    const base = new URL(start);
    const maxDepth = Math.max(0, Math.min(3, Number(depth) || 0));
    const limit = Math.max(1, Math.min(500, Number(maxFiles) || 100));
    const requested = Array.isArray(extensions) ? extensions.map(value => String(value).trim().toLowerCase()).filter(Boolean) : [];
    const extensionSet = new Set();
    for (const value of requested) {
      const category = allowedCategory(value);
      if (category) for (const extension of CATEGORY_EXTENSIONS[category] || []) extensionSet.add(extension);
      else extensionSet.add(value.startsWith('.') ? value : `.${value}`);
    }
    const queue = [{ url: start, depth: 0 }], visited = new Set(), addedUrls = new Set(), jobs = [];
    const stats = { pages: 0, added: 0, skipped: 0 };
    const requestHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) if (['cookie', 'authorization', 'user-agent', 'referer', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) requestHeaders[key.toLowerCase()] = value;
    const isSameOrigin = candidate => { try { return new URL(candidate).origin === base.origin; } catch { return false; } };
    const knownExtension = extension => Object.values(CATEGORY_EXTENSIONS).some(values => values.has(extension));
    while (queue.length && addedUrls.size < limit) {
      const current = queue.shift();
      if (visited.has(current.url) || !isSameOrigin(current.url)) continue;
      visited.add(current.url);
      let response;
      try { response = await fetch(current.url, { headers: { accept: 'text/html,application/xhtml+xml', ...requestHeaders }, redirect: 'follow', signal: AbortSignal.timeout(12_000) }); }
      catch { stats.skipped++; continue; }
      if (!response.ok) { stats.skipped++; await response.body?.cancel(); continue; }
      const finalUrl = response.url || current.url;
      if (!isSameOrigin(finalUrl)) { stats.skipped++; await response.body?.cancel(); continue; }
      const contentType = response.headers.get('content-type') || '';
      const extension = path.extname(new URL(finalUrl).pathname).toLowerCase();
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType) || !extension || extension === '.html' || extension === '.htm';
      if (!isHtml) {
        const category = classifyCategory(finalUrl, contentType);
        if ((extensionSet.size ? extensionSet.has(extension) || requested.includes(category) : knownExtension(extension)) && addedUrls.add(finalUrl)) {
          try { jobs.push(await this.add({ url: finalUrl, category, headers: requestHeaders })); stats.added++; }
          catch { stats.skipped++; }
        } else stats.skipped++;
        await response.body?.cancel();
        continue;
      }
      stats.pages++;
      let html;
      try { html = await response.text(); } catch { stats.skipped++; continue; }
      if (html.length > 4 * 1024 * 1024) html = html.slice(0, 4 * 1024 * 1024);
      if (current.depth >= maxDepth) continue;
      for (const match of html.matchAll(/(?:href|src|data-src)\s*=\s*["']([^"'#]+)["']/gi)) {
        let candidate;
        try { candidate = new URL(match[1], finalUrl); } catch { continue; }
        candidate.hash = '';
        if (!isSameOrigin(candidate.href) || !['http:', 'https:'].includes(candidate.protocol)) continue;
        const child = candidate.href;
        const childExtension = path.extname(candidate.pathname).toLowerCase();
        const childCategory = classifyCategory(child, '');
        const downloadable = childExtension && (extensionSet.size ? extensionSet.has(childExtension) || requested.includes(childCategory) : knownExtension(childExtension));
        if (downloadable) {
          if (addedUrls.size >= limit || addedUrls.has(child)) continue;
          addedUrls.add(child);
          try { jobs.push(await this.add({ url: child, category: childCategory, headers: requestHeaders })); stats.added++; }
          catch { stats.skipped++; }
        } else if (current.depth < maxDepth && (childExtension === '' || childExtension === '.html' || childExtension === '.htm')) {
          if (!visited.has(child)) queue.push({ url: child, depth: current.depth + 1 });
        }
      }
    }
    return { ...stats, jobs: jobs.map(job => job.id) };
  }
  async action(id, action) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new Error('Unduhan tidak ditemukan.');
    if (action === 'resume' && ['paused', 'error'].includes(job.status)) {
      job.status = 'queued'; job.error = null;
    } else if (action === 'pause' && ['queued', 'downloading', 'assembling'].includes(job.status)) {
      job.status = this.active.has(id) ? 'pausing' : 'paused';
      this.active.get(id)?.controller.abort();
    } else if (action === 'cancel' && ['queued', 'downloading', 'assembling', 'paused', 'error'].includes(job.status)) {
      job.status = this.active.has(id) ? 'cancelling' : 'cancelled';
      this.active.get(id)?.controller.abort();
    } else throw new Error('Tindakan tidak tersedia untuk status unduhan ini.');
    await this.persist(); this.changed(job); this.pump();
    return this.list().find(item => item.id === id);
  }
  // Remove a job from the list (like IDM "Delete"). Partial data is deleted;
  // a finished file on disk is never touched.
  async remove(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new Error('Unduhan tidak ditemukan.');
    const entry = this.active.get(id);
    if (entry) {
      if (job.status !== 'assembling') job.status = 'cancelling';
      entry.controller.abort();
      await entry.promise?.catch(() => {});
      for (let i = 0; i < 200 && this.active.has(id); i++) await wait(25);
    }
    this.jobs = this.jobs.filter(item => item !== job);
    this.credentials.delete(id); this.audioCredentials.delete(id);
    const parts = path.join(this.dataDirectory, 'parts');
    for (let index = 0; index < Math.max(job.parts?.length || 0, this.connections); index++) await fs.rm(this.partPath(job, index), { force: true }).catch(() => {});
    for (const name of [id, `${id}.assembled`, `${id}.media.mp4`, `${id}.browser.out`]) await fs.rm(path.join(parts, name), { recursive: true, force: true }).catch(() => {});
    await this.persist();
    this.emit('removed', id);
    return { removed: id };
  }
  // Queue order is oldest-first among queued jobs (the "Q" column). The job list
  // itself is newest-first, so queued positions are written back in reverse.
  async moveQueue(id, direction) {
    const isQueued = job => job.status === 'queued';
    const order = this.jobs.filter(isQueued).reverse();
    const index = order.findIndex(job => job.id === id);
    if (index < 0) throw new Error('Hanya unduhan berstatus Antrean yang dapat dipindahkan.');
    const target = { up: index - 1, down: index + 1, top: 0, bottom: order.length - 1 }[direction];
    if (target === undefined) throw new Error('Arah pemindahan tidak dikenal.');
    const [job] = order.splice(index, 1); order.splice(Math.max(0, Math.min(order.length, target)), 0, job);
    const positions = this.jobs.map((item, position) => isQueued(item) ? position : -1).filter(position => position >= 0);
    positions.forEach((position, k) => { this.jobs[position] = order[order.length - 1 - k]; });
    await this.persist(); this.changed(job);
    return { order: order.map(item => item.id) };
  }
  // ---- "Perbarui alamat": point an unfinished job at a fresh link ----
  armRefresh(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new Error('Unduhan tidak ditemukan.');
    if (job.status === 'completed') throw new Error('Unduhan ini sudah selesai.');
    if (job.kind === 'youtube') throw new Error('Unduhan YouTube selalu membaca alamat terbaru sendiri. Cukup klik Lanjut.');
    this.refreshPending = { id, until: Date.now() + 3 * 60_000 };
    this.changed(job);
    return this.refreshState();
  }
  refreshState() {
    const pending = this.refreshPending && this.refreshPending.until > Date.now() && this.jobs.some(job => job.id === this.refreshPending.id) ? this.refreshPending : null;
    if (!pending) this.refreshPending = null;
    return pending ? { id: pending.id, until: new Date(pending.until).toISOString() } : null;
  }
  cancelRefresh() { this.refreshPending = null; return null; }
  pendingRefreshFor(kind) {
    const pending = this.refreshState(); if (!pending) return null;
    const job = this.jobs.find(item => item.id === pending.id);
    return job && (job.kind || 'http') === kind ? job : null;
  }
  async stopForRefresh(job) {
    const entry = this.active.get(job.id);
    if (entry) { job.status = 'pausing'; entry.controller.abort(); await entry.promise?.catch(() => {}); }
  }
  async refreshAddress(id, { url, headers = {} } = {}) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new Error('Unduhan tidak ditemukan.');
    if (job.kind && job.kind !== 'http') throw new Error('Untuk unduhan video, perbarui alamat lewat tombol ZIVAR di halaman videonya.');
    return this.applyHttpRefresh(job, { url, headers });
  }
  async applyHttpRefresh(job, { url, headers = {} }) {
    const next = httpUrl(url);
    await this.stopForRefresh(job);
    if (job.status === 'completed') throw new Error('Unduhan ini sudah selesai.');
    const permitted = {};
    for (const [key, value] of Object.entries(headers || {})) if (['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) permitted[key.toLowerCase()] = value;
    job.url = next; this.credentials.set(job.id, permitted);
    if (job.total) job.refreshCheckTotal = job.total;
    job.status = 'queued'; job.error = null; job.refreshedAt = new Date().toISOString();
    this.refreshPending = null;
    await this.persist(); this.changed(job); this.pump();
    return { ...this.list().find(item => item.id === job.id), refreshed: true };
  }
  // A download that came with a known SHA-256 (e.g. an app update) is checked after it finishes;
  // a mismatching file is deleted so it cannot be opened by mistake.
  async verifyExpected(job) {
    const { hash } = await this.checksum(job.id, 'sha256');
    if (hash === job.expectedSha256) { job.verified = true; return; }
    await fs.rm(job.outputPath, { force: true }).catch(() => {});
    job.outputPath = null; job.verified = false;
    throw new Error('Checksum file tidak cocok dengan yang diharapkan, jadi file dihapus. Coba unduh lagi.');
  }
  async checksum(id, algorithm = 'sha256') {
    const job = this.jobs.find(item => item.id === id);
    if (!job?.outputPath || job.status !== 'completed') throw new Error('Checksum hanya tersedia untuk unduhan yang sudah selesai.');
    if (!['sha256', 'sha1', 'md5'].includes(algorithm)) throw new Error('Algoritma tidak didukung.');
    const { createHash } = await import('node:crypto');
    const hash = createHash(algorithm);
    const file = await fs.open(job.outputPath, 'r').catch(() => { throw new Error('File hasil tidak ditemukan. Mungkin sudah dipindahkan atau dihapus.'); });
    try { for await (const bytes of file.createReadStream()) hash.update(bytes); } finally { await file.close().catch(() => {}); }
    return { algorithm, hash: hash.digest('hex'), path: job.outputPath };
  }
  pump() {
    if (this.closing || !this.scheduleOpen()) return;
    // Browser jobs are driven by the Chrome extension, not by this queue.
    for (const job of this.jobs.filter(item => item.status === 'queued' && item.kind !== 'browser').reverse()) {
      if (this.active.size >= this.concurrency) break;
      const controller = new AbortController();
      const entry = { controller };
      this.active.set(job.id, entry);
      job.status = 'downloading'; job.error = null; this.changed(job);
      entry.promise = this.run(job, controller.signal).catch(error => {
        job.status = job.status === 'cancelling' ? 'cancelled' : job.status === 'pausing' ? 'paused' : 'error';
        job.error = job.status === 'error' ? error.message : null;
      }).finally(async () => {
        job.speed = 0; this.active.delete(job.id); this.changed(job);
        if (TERMINAL.has(job.status)) this.credentials.delete(job.id);
        if (TERMINAL.has(job.status)) this.audioCredentials.delete(job.id);
        await this.persist().catch(() => {}); this.pump();
      });
    }
  }
  partPath(job, index) { return path.join(this.dataDirectory, 'parts', `${job.id}.${index}.part`); }
  async probe(job, signal) {
    const req = await request(job.url, { ...this.credentials.get(job.id), range: 'bytes=0-0' }, signal);
    try {
      const { response } = req;
      if (![200, 206].includes(response.status)) throw new Error(`Server membalas HTTP ${response.status}. URL mungkin kedaluwarsa atau memerlukan login.`);
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw new Error('Server mengirim kompresi transfer yang tidak didukung untuk unduhan byte-exact.');
      const contentType = response.headers.get('content-type') || '';
      if (isStream(contentType)) throw new Error('Manifest streaming HLS/DASH belum didukung. Pilih video MP4/WebM langsung.');
      const range = /^bytes 0-0\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (response.status === 206 && !range) throw new Error('Server mengirim Content-Range yang tidak valid.');
      const total = response.status === 206 ? number(range?.[1]) : number(response.headers.get('content-length'));
      if (response.status === 206 && (!total || total < 1)) throw new Error('Ukuran file dari server tidak valid.');
      const rawEtag = response.headers.get('etag');
      return {
        total, supportsRanges: response.status === 206, contentType,
        etag: rawEtag && !rawEtag.startsWith('W/') ? rawEtag : null,
        lastModified: response.headers.get('last-modified'),
        suggestedName: filenameFrom(response.headers, req.url), finalUrl: req.url,
      };
    } finally { await req.response.body?.cancel().catch(() => {}); req.dispose(); }
  }
  async run(job, signal) {
    if (job.kind === 'youtube') return this.runYoutube(job, signal);
    if (job.kind === 'media') return this.runMedia(job, signal);
    const metadata = await this.probe(job, signal);
    signal.throwIfAborted();
    // After "Perbarui alamat", the new link must point to the same file.
    if (job.refreshCheckTotal && metadata.total && metadata.total !== job.refreshCheckTotal) throw new Error(`Alamat baru mengarah ke file yang berbeda (ukuran ${metadata.total} byte, seharusnya ${job.refreshCheckTotal} byte). Perbarui lagi dengan tautan yang benar.`);
    delete job.refreshCheckTotal;
    const validator = metadata.etag || metadata.lastModified;
    const reusable = validator && job.total === metadata.total && job.etag === metadata.etag && job.lastModified === metadata.lastModified && metadata.supportsRanges;
    if (!reusable) {
      for (let index = 0; index < Math.max(job.parts.length, 16); index++) await fs.rm(this.partPath(job, index), { force: true });
      job.parts = [];
    }
    Object.assign(job, metadata);
    if (!job.customFilename) job.filename = safeFilename(metadata.suggestedName);
    if (!job.categoryExplicit) job.category = classifyCategory(job.filename, metadata.contentType);
    if (!job.parts.length) {
      const count = metadata.supportsRanges && validator && metadata.total >= 2 * 1024 * 1024 ? this.connections : 1;
      const size = metadata.total === null ? null : Math.ceil(metadata.total / count);
      job.parts = Array.from({ length: count }, (_, index) => ({ start: size === null ? 0 : size * index, end: size === null ? null : Math.min(metadata.total - 1, size * (index + 1) - 1), received: 0 }));
    }
    // Disk size is authoritative after a crash, never an old progress snapshot.
    for (const [index, part] of job.parts.entries()) {
      part.received = (await fs.stat(this.partPath(job, index)).catch(() => ({ size: 0 }))).size;
      if (!reusable || part.end !== null && part.received > part.end - part.start + 1) {
        await fs.writeFile(this.partPath(job, index), ''); part.received = 0;
      }
    }
    job.connectionCount = job.parts.length;
    job.received = job.parts.reduce((sum, part) => sum + part.received, 0);
    await this.persist(); this.changed(job);
    let previous = job.received, previousTime = Date.now();
    const progress = setInterval(() => {
      const now = Date.now(); job.speed = Math.max(0, (job.received - previous) * 1000 / (now - previousTime));
      previous = job.received; previousTime = now; this.changed(job);
    }, 500);
    const group = new AbortController();
    const transferSignal = AbortSignal.any([signal, group.signal]);
    const workers = job.parts.map((part, index) => this.transfer(job, part, index, transferSignal).catch(error => { group.abort(error); throw error; }));
    try {
      const results = await Promise.allSettled(workers);
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw group.signal.reason || failure.reason;
      signal.throwIfAborted();
      if (job.total !== null && job.received !== job.total) throw new Error('Ukuran file hasil unduhan tidak sesuai.');
      job.status = 'assembling'; job.speed = 0; this.changed(job);
      const assembled = path.join(this.dataDirectory, 'parts', `${job.id}.assembled`);
      const output = await fs.open(assembled, 'w');
      try {
        for (let index = 0; index < job.parts.length; index++) {
          const input = await fs.open(this.partPath(job, index), 'r');
          try { for await (const bytes of input.createReadStream()) await output.writeFile(bytes); }
          finally { await input.close(); }
        }
        await output.sync();
      } finally { await output.close(); }
      let destination;
      const extension = path.extname(job.filename), stem = job.filename.slice(0, job.filename.length - extension.length);
      for (let suffix = 0; suffix < 10_000; suffix++) {
        const filename = suffix ? `${stem} (${suffix})${extension}` : job.filename;
        destination = path.join(this.settingsState.categoryFolders ? path.join(this.downloadDirectory, job.category || 'other') : this.downloadDirectory, filename);
        if (this.settingsState.categoryFolders) await fs.mkdir(path.dirname(destination), { recursive: true });
        try { await fs.copyFile(assembled, destination, fs.constants.COPYFILE_EXCL); job.filename = filename; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; destination = null; }
      }
      if (!destination) throw new Error('Tidak dapat membuat nama file yang unik.');
      job.outputPath = destination; job.completedAt = new Date().toISOString(); job.status = 'completed';
      // Cleanup failure must not turn a successfully published download into a retry.
      for (let index = 0; index < job.parts.length; index++) await fs.rm(this.partPath(job, index), { force: true }).catch(() => {});
      await fs.rm(assembled, { force: true }).catch(() => {});
      if (job.expectedSha256) await this.verifyExpected(job);
    } finally { clearInterval(progress); }
  }
  async runYoutube(job, signal) {
    const directory = path.join(this.dataDirectory, 'parts', job.id);
    const output = await downloadYoutube(job, directory, signal, data => {
      job.received = data.received; job.total = data.total; job.totalEstimated = data.estimated;
      job.speed = data.speed; this.changed(job);
    }, this.settingsState.speedLimit);
    signal.throwIfAborted();
    const folder = this.settingsState.categoryFolders ? path.join(this.downloadDirectory, job.category || 'video') : this.downloadDirectory;
    await fs.mkdir(folder, { recursive:true });
    const ext = path.extname(output) || '.mp4';
    const stem = safeFilename(job.filename).replace(/\.(mp4|m4a|mp3)$/i, '');
    for (let i = 0; i < 10000; i++) {
      const filename = stem + (i ? ' (' + i + ')' : '') + ext;
      const destination = path.join(folder, filename);
      try { await fs.copyFile(output, destination, fs.constants.COPYFILE_EXCL); job.filename = filename; job.outputPath = destination; break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!job.outputPath) throw new Error('Nama file hasil tidak tersedia.');
    job.received = job.total = (await fs.stat(job.outputPath)).size; job.totalEstimated = false;
    job.status = 'completed'; job.completedAt = new Date().toISOString();
    await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
  }
  // ---- Browser-assisted downloads ----------------------------------------------
  // Some sites only serve media to a real browser. For those, the Chrome extension
  // downloads the bytes itself and uploads them here in ordered chunks.
  async probeAccess({ url, headers = {} } = {}) {
    const permitted = {};
    for (const [key, value] of Object.entries(headers || {})) if (['cookie', 'referer', 'user-agent', 'authorization', 'origin'].includes(key.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) permitted[key.toLowerCase()] = value;
    const req = await request(url, { ...permitted, range: 'bytes=0-0' }, AbortSignal.timeout(15_000));
    try { return { status: req.response.status }; } finally { await req.response.body?.cancel().catch(() => {}); req.dispose(); }
  }
  async addBrowser({ filename, parts, pageUrl = null } = {}) {
    if (this.closing) throw new Error('Aplikasi sedang berhenti.');
    if (!Array.isArray(parts) || !parts.length || parts.length > 2) throw new Error('Daftar file unduhan browser tidak valid.');
    const keys = parts.map(part => part?.key);
    if (!(keys.join() === 'file' || keys.join() === 'video' || keys.join() === 'video,audio')) throw new Error('Jenis file unduhan browser tidak valid.');
    const sources = parts.map(part => httpUrl(part.url));
    const refreshTarget = this.pendingRefreshFor('browser');
    if (refreshTarget && refreshTarget.parts.map(part => part.key).join() === keys.join() && !['completed', 'assembling'].includes(refreshTarget.status)) {
      refreshTarget.sourceUrls = sources; refreshTarget.status = 'downloading'; refreshTarget.error = null; refreshTarget.refreshedAt = new Date().toISOString();
      this.refreshPending = null;
      await this.persist(); this.changed(refreshTarget);
      return { ...this.browserState(refreshTarget), refreshed: true };
    }
    const duplicate = this.jobs.find(job => job.kind === 'browser' && job.sourceUrls?.[0] === sources[0] && ['queued', 'downloading', 'assembling'].includes(job.status));
    if (duplicate) return this.browserState(duplicate);
    if (this.jobs.length >= 2000) throw new Error('Daftar unduhan penuh (maksimal 2.000).');
    let name = safeFilename(filename || filenameFrom(new Headers(), sources[0]));
    if (keys[0] !== 'file' && !/\.mp4$/i.test(name)) name += '.mp4';
    const job = {
      id: randomUUID(), kind: 'browser', url: pageUrl && /^https?:\/\//i.test(pageUrl) ? httpUrl(pageUrl) : sources[0], sourceUrls: sources,
      filename: name, category: keys[0] === 'file' ? classifyCategory(name) : 'video', categoryExplicit: true, customFilename: true,
      status: 'downloading', createdAt: new Date().toISOString(), received: 0, total: null, speed: 0, error: null, connectionCount: 1,
      parts: keys.map(key => ({ key, total: null, received: 0 })),
    };
    this.jobs.unshift(job);
    try { await this.persist(); } catch (error) { this.jobs = this.jobs.filter(item => item !== job); throw error; }
    this.changed(job);
    return this.browserState(job);
  }
  browserJob(id) {
    const job = this.jobs.find(item => item.id === id && item.kind === 'browser');
    if (!job) throw new Error('Unduhan browser tidak ditemukan.');
    return job;
  }
  browserState(job) {
    return { id: job.id, status: job.status, filename: job.filename, error: job.error, parts: job.parts.map(({ key, received, total }) => ({ key, received, total })) };
  }
  // One chunk at a time per job, so offsets can never interleave.
  browserLocked(job, operation) {
    this.browserLocks ||= new Map();
    const next = (this.browserLocks.get(job.id) || Promise.resolve()).then(operation);
    this.browserLocks.set(job.id, next.catch(() => {}));
    return next;
  }
  async browserChunk(id, { key, offset, total, restart = false }, bytes) {
    const job = this.browserJob(id);
    return this.browserLocked(job, async () => {
      if (!['downloading', 'queued'].includes(job.status)) return this.browserState(job);
      const index = job.parts.findIndex(part => part.key === key);
      if (index < 0) throw new Error('Bagian file tidak dikenal.');
      const part = job.parts[index], file = this.partPath(job, index);
      // HLS tracks restart from zero when their resume point is unknown.
      if (restart && offset === 0) { await fs.writeFile(file, ''); part.received = 0; part.total = null; }
      if (Number.isSafeInteger(total) && total > 0) {
        if (part.total && part.total !== total) throw new Error('Ukuran file di server berubah. Mulai unduhan lagi dari halaman video.');
        part.total = total;
      }
      const size = (await fs.stat(file).catch(() => ({ size: 0 }))).size;
      if (offset !== size) { part.received = size; return { ...this.browserState(job), conflict: true }; }
      if (part.total && size + bytes.length > part.total) throw new Error('Data yang diterima melebihi ukuran file.');
      if (bytes.length) await fs.appendFile(file, bytes);
      part.received = size + bytes.length;
      if (!part.total && !bytes.length) part.total = part.received; // stream ended without a known size
      const now = Date.now(), elapsed = (now - (job.browserLastAt || now)) / 1000;
      if (elapsed > 0) job.speed = Math.round((job.speed || 0) * 0.5 + (bytes.length / elapsed) * 0.5);
      job.browserLastAt = now; job.status = 'downloading'; job.error = null;
      job.received = job.parts.reduce((sum, item) => sum + item.received, 0);
      job.total = job.parts.every(item => item.total) ? job.parts.reduce((sum, item) => sum + item.total, 0) : null;
      this.changed(job);
      return this.browserState(job);
    });
  }
  async browserFail(id, message) {
    const job = this.browserJob(id);
    if (['downloading', 'queued'].includes(job.status)) { job.status = 'error'; job.speed = 0; job.error = String(message || 'Unduhan lewat browser gagal.').slice(0, 300); await this.persist(); this.changed(job); }
    return this.browserState(job);
  }
  async browserFinish(id) {
    const job = this.browserJob(id);
    if (!['downloading', 'queued'].includes(job.status)) return this.browserState(job);
    if (!job.parts.every(part => part.total && part.received === part.total)) throw new Error('Unduhan belum lengkap.');
    const controller = new AbortController();
    this.active.set(job.id, { controller });
    job.status = 'assembling'; job.speed = 0; this.changed(job);
    (async () => {
      const assembled = path.join(this.dataDirectory, 'parts', `${job.id}.browser.out`);
      try {
        const keys = job.parts.map(part => part.key);
        if (keys[0] === 'file') await fs.copyFile(this.partPath(job, 0), assembled);
        else await muxFiles({ videoPath: this.partPath(job, 0), audioPath: keys[1] === 'audio' ? this.partPath(job, 1) : null, outputPath: assembled + '.mp4', signal: controller.signal }).then(() => fs.rename(assembled + '.mp4', assembled));
        controller.signal.throwIfAborted();
        const folder = this.settingsState.categoryFolders ? path.join(this.downloadDirectory, job.category || 'other') : this.downloadDirectory;
        await fs.mkdir(folder, { recursive: true });
        const extension = path.extname(job.filename), stem = job.filename.slice(0, job.filename.length - extension.length);
        for (let suffix = 0; suffix < 10_000 && !job.outputPath; suffix++) {
          const filename = suffix ? `${stem} (${suffix})${extension}` : job.filename;
          try { await fs.copyFile(assembled, path.join(folder, filename), fs.constants.COPYFILE_EXCL); job.filename = filename; job.outputPath = path.join(folder, filename); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (!job.outputPath) throw new Error('Tidak dapat membuat nama file yang unik.');
        job.received = job.total = (await fs.stat(job.outputPath)).size;
        job.status = 'completed'; job.completedAt = new Date().toISOString();
        for (let index = 0; index < job.parts.length; index++) await fs.rm(this.partPath(job, index), { force: true }).catch(() => {});
      } catch (error) {
        job.status = job.status === 'cancelling' ? 'cancelled' : job.status === 'pausing' ? 'paused' : 'error';
        job.error = job.status === 'error' ? error.message : null;
      } finally {
        await fs.rm(assembled, { force: true }).catch(() => {});
        this.active.delete(job.id); job.speed = 0; this.changed(job);
        await this.persist().catch(() => {}); this.pump();
      }
    })();
    return this.browserState(job);
  }
  async runMedia(job, signal) {
    const assembled = path.join(this.dataDirectory, 'parts', `${job.id}.media.mp4`);
    job.status = 'assembling'; job.mediaPosition = 0; job.received = 0; job.total = null; this.changed(job);
    try {
      await muxMedia({
        inputUrl: job.inputUrl,
        audioUrl: job.audioUrl,
        outputPath: assembled,
        headers: this.credentials.get(job.id) || {},
        audioHeaders: this.audioCredentials.get(job.id) || {},
        signal,
        onProgress: (position, duration) => {
          if (Number.isFinite(position)) { job.mediaPosition = position; job.received = position; }
          if (Number.isFinite(duration)) { job.mediaDuration = duration; job.total = duration; }
          this.changed(job);
        },
      });
      signal.throwIfAborted();
      let destination;
      const extension = path.extname(job.filename) || '.mp4';
      const stem = job.filename.slice(0, job.filename.length - extension.length);
      for (let suffix = 0; suffix < 10_000; suffix++) {
        const filename = suffix ? `${stem} (${suffix})${extension}` : job.filename;
        destination = path.join(this.settingsState.categoryFolders ? path.join(this.downloadDirectory, job.category || 'video') : this.downloadDirectory, filename);
        if (this.settingsState.categoryFolders) await fs.mkdir(path.dirname(destination), { recursive: true });
        try { await fs.copyFile(assembled, destination, fs.constants.COPYFILE_EXCL); job.filename = filename; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; destination = null; }
      }
      if (!destination) throw new Error('Tidak dapat membuat nama file yang unik.');
      job.outputPath = destination; job.completedAt = new Date().toISOString(); job.status = 'completed';
      if (job.mediaDuration) job.mediaPosition = job.mediaDuration;
      job.received = job.mediaPosition; job.total = job.mediaDuration;
      job.outputSize = (await fs.stat(destination).catch(() => null))?.size || null;
      await fs.rm(assembled, { force: true }).catch(() => {});
    } finally {
      if (job.status !== 'completed') await fs.rm(assembled, { force: true }).catch(() => {});
    }
  }
  async transfer(job, part, index, signal) {
    const expected = part.end === null ? null : part.end - part.start + 1;
    if (expected !== null && part.received === expected) return;
    const headers = { ...this.credentials.get(job.id) };
    const ranged = job.supportsRanges && Boolean(job.etag || job.lastModified);
    if (ranged) { headers.range = `bytes=${part.start + part.received}-${part.end ?? ''}`; headers['if-range'] = job.etag || job.lastModified; }
    const req = await request(job.url, headers, signal);
    let file;
    try {
      const { response } = req;
      if (response.status !== (ranged ? 206 : 200)) throw new Error(`HTTP ${response.status}: server tidak memenuhi permintaan unduh/range. Klik Lanjut untuk mencoba lagi.`);
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw new Error('Server mengirim transfer terkompresi yang tidak didukung.');
      if (ranged) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!match || Number(match[1]) !== part.start + part.received || Number(match[2]) !== part.end || Number(match[3]) !== job.total) throw new Error('Content-Range berubah. Klik Lanjut untuk memeriksa ulang file.');
        if (job.etag && response.headers.get('etag') && response.headers.get('etag') !== job.etag) throw new Error('Versi file berubah saat diunduh. Klik Lanjut untuk memulai ulang.');
      }
      if (!response.body) throw new Error('Server tidak mengirim isi file.');
      file = await fs.open(this.partPath(job, index), 'a');
      for await (const bytes of response.body) {
        signal.throwIfAborted(); req.touch();
        if (expected !== null && part.received + bytes.length > expected) throw new Error('Server mengirim data melebihi ukuran file.');
        await file.writeFile(bytes); part.received += bytes.length; job.received += bytes.length;
        await this.throttle(bytes.length, signal, req.touch);
      }
      if (expected !== null && part.received !== expected) throw new Error('Koneksi terputus sebelum file selesai. Klik Lanjut untuk mencoba lagi.');
      await file.sync();
    } finally {
      await file?.close();
      await req.response.body?.cancel().catch(() => {}); req.dispose();
    }
  }
  async close() {
    if (!this.closePromise) this.closePromise = this.shutdown();
    return this.closePromise;
  }
  async shutdown() {
    this.closing = true;
    clearInterval(this.schedulerTimer); this.schedulerTimer = null;
    for (const [id, entry] of this.active) {
      const job = this.jobs.find(item => item.id === id);
      if (['downloading', 'assembling'].includes(job.status)) { job.status = 'pausing'; entry.controller.abort(); }
    }
    await Promise.allSettled([...this.active.values()].map(entry => entry.promise));
    clearTimeout(this.saveTimer); this.saveTimer = null;
    await this.persist();
  }
}
