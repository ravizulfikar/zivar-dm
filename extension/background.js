const endpoint = 'http://127.0.0.1:18765';
const mediaTypes = /^(video\/(mp4|webm|quicktime|x-m4v)|audio\/(mpeg|mp4|webm)|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i;
const directPattern = /\.(mp4|webm|m4v|mov|mp3|m4a)(?:[?#]|$)/i;
const streamPattern = /\.(m3u8|mpd)(?:[?#]|$)/i;
const videoPattern = /\.(mp4|webm|m4v|mov)(?:[?#]|$)/i;
const validUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
// Video ads (IMA/VAST pre-rolls) are often plain MP4 files and would otherwise look
// like the "best" downloadable video. Keep this list in sync with content.js.
const adHosts = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|2mdn\.net|imasdk\.googleapis\.com|adsafeprotected\.com|springserve\.com|spotxchange\.com|spotx\.tv|innovid\.com|teads\.tv|tremorhub\.com|adnxs\.com|pubmatic\.com|moatads\.com|serving-sys\.com|flashtalking\.com|vidazoo\.com|aniview\.com|adform\.net|smartadserver\.com|unrulymedia\.com)$/i;
const adPath = /(?:^|[/_.-])(?:ads?|adserver|adverts?|advertising|preroll|midroll|postroll|dclk_video_ads)(?:[/_.-]|$)/i;
function isAd(value) { try { const url = new URL(value); return adHosts.test(url.hostname) || adPath.test(url.pathname); } catch { return false; } }
let storageChain = Promise.resolve();
function modify(operation) { const next = storageChain.then(operation); storageChain = next.catch(() => {}); return next; }
const manifestCache = new Map();
const manifestTtl = 15000;
const credentialTtl = 5 * 60 * 1000;
const credentialHeaders = ['cookie', 'authorization', 'user-agent', 'origin', 'referer'];
const downloadInfoPrefix = 'download-info:';
const downloadCredentialPrefix = 'download-credentials:';
const downloadInfoKey = id => `${downloadInfoPrefix}${id}`;
const downloadCredentialKey = id => `${downloadCredentialPrefix}${id}`;
const defaultBrowserDownloadTypes = [
  '3GP', '7Z', 'AAC', 'ACE', 'AIF', 'APK', 'ARJ', 'ASF', 'AVI', 'BIN', 'BZ2', 'EXE', 'GZ', 'GZIP', 'IMG', 'ISO',
  'LZH', 'M4A', 'M4V', 'MKV', 'MOV', 'MP3', 'MP4', 'MPA', 'MPE', 'MPEG', 'MPG', 'MSI', 'MSU', 'OGG', 'OGV', 'PDF',
  'PLJ', 'PPS', 'PPT', 'QT', 'R0*', 'R1*', 'RA', 'RAR', 'RM', 'RMVB', 'SEA', 'SIT', 'SITX', 'TAR', 'TIF', 'TIFF',
  'WAV', 'WMA', 'WMV', 'Z', 'ZIP',
];
const defaultBrowserDownloadSiteExclusions = [
  '*.update.microsoft.com', 'download.windowsupdate.com', '*.download.windowsupdate.com', 'siteseal.thawte.com',
  'ecom.cimetz.com', '*.voice2page.com',
];
const browserRulesTtl = 10_000;
let browserRulesCache = { time: 0, types: defaultBrowserDownloadTypes, siteExclusions: defaultBrowserDownloadSiteExclusions };
function normalizedBrowserRuleList(value, fallback, pattern) {
  if (value === undefined || value === null) return [...fallback];
  const values = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  return [...new Set(values.map(item => String(item).trim().toUpperCase().replace(/^\./, '')).filter(item => pattern.test(item)))];
}
function downloadExtension(value) {
  const clean = String(value || '').split(/[?#]/, 1)[0].replace(/[\\/]+$/, '');
  const name = clean.split(/[\\/]/).pop() || '';
  return /\.([A-Za-z0-9]{1,12})$/.exec(name)?.[1].toUpperCase() || '';
}
function browserDownloadTypeMatches(download, types) {
  const extension = [downloadFilename(download), download.finalUrl, download.url].map(downloadExtension).find(Boolean) || '';
  return Boolean(extension && types.some(pattern => pattern.endsWith('*') ? extension.startsWith(pattern.slice(0, -1)) : extension === pattern));
}
function browserDownloadSiteExcluded(download, siteExclusions) {
  let hostname;
  try { hostname = new URL(download.finalUrl || download.url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return false; }
  return siteExclusions.some(pattern => {
    pattern = pattern.toLowerCase();
    const wildcard = pattern.startsWith('*.');
    const base = wildcard ? pattern.slice(2) : pattern;
    return wildcard ? (hostname === base || hostname.endsWith(`.${base}`)) : hostname === base;
  });
}
function attributes(text) {
  const result = {};
  String(text || '').replace(/([A-Za-z][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|[^,\s>]+)/g, (_, key, value) => { result[key.toUpperCase()] = value.replace(/^['"]|['"]$/g, ''); return _; });
  return result;
}
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
const credentialLimit = { cookie: 16000, authorization: 4096, 'user-agent': 512, origin: 2048, referer: 2048 };
async function credentialsFor(tabId, url) {
  if (!Number.isInteger(tabId) || tabId < 0 || !validUrl(url) || typeof chrome.storage.session?.get !== 'function') return {};
  let origin; try { origin = new URL(url).origin; } catch { return {}; }
  const key = `credentials:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key] || {};
  const record = stored[origin];
  if (!record || Date.now() - record.time > credentialTtl) return {};
  return { ...(record.headers || {}) };
}
function downloadFilename(download) {
  const local = String(download.filename || '').split(/[\\/]/).pop();
  if (local) return local;
  try { return decodeURIComponent(new URL(download.finalUrl || download.url).pathname.split('/').pop() || '') || 'download'; } catch { return 'download'; }
}
function downloadId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error('ID download tidak valid.');
  return id;
}
async function pendingDownload(id) {
  const key = downloadInfoKey(id);
  return (await chrome.storage.local.get(key))[key] || null;
}
async function savePendingDownload(record) {
  await chrome.storage.local.set({ [downloadInfoKey(record.id)]: record });
}
async function removePendingDownload(id) {
  await chrome.storage.local.remove([downloadInfoKey(id)]);
  if (typeof chrome.storage.session?.remove === 'function') await chrome.storage.session.remove(downloadCredentialKey(id)).catch(() => {});
}
async function downloadItem(id) {
  return (await chrome.downloads.search({ id }))[0] || null;
}
async function capturedDownloadInfo(id) {
  const record = await pendingDownload(id);
  if (!record) throw new Error('Info download sudah tidak tersedia.');
  const item = await downloadItem(id);
  if (!item || ['complete', 'interrupted'].includes(item.state)) {
    await removePendingDownload(id);
    throw new Error('Download Chrome sudah tidak dapat dilanjutkan.');
  }
  return { ...record, filename: record.filename || downloadFilename(item), state: item.state, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes > 0 ? item.totalBytes : record.totalBytes, mime: item.mime || record.mime };
}
async function openDownloadInfo(id) {
  const url = `${chrome.runtime.getURL('download.html')}?id=${encodeURIComponent(id)}`;
  try {
    const popup = await chrome.windows.create({ url, type: 'popup', width: 520, height: 650, focused: true });
    return { windowId: popup.id, tabId: popup.tabs?.[0]?.id ?? null };
  } catch {
    const tab = await chrome.tabs.create({ url });
    return { windowId: null, tabId: tab.id };
  }
}
const interceptingDownloads = new Map();
const browserLinkContexts = new Map();
const browserLinkContextById = new Map();
function browserLinkContextKey(url, filename) { return `${url}\n${filename || ''}`; }
function registerBrowserLinkContext(url, filename, context) {
  const key = browserLinkContextKey(url, filename);
  const queue = browserLinkContexts.get(key) || [];
  queue.push(context); browserLinkContexts.set(key, queue);
}
function takeBrowserLinkContext(download) {
  const byId = browserLinkContextById.get(download.id);
  if (byId) { browserLinkContextById.delete(download.id); return byId; }
  const key = browserLinkContextKey(download.finalUrl || download.url, downloadFilename(download));
  const queue = browserLinkContexts.get(key);
  const context = queue?.shift();
  if (queue?.length) browserLinkContexts.set(key, queue); else browserLinkContexts.delete(key);
  if (context) context.claimed = true;
  return context || null;
}
async function interceptDownload(download) {
  const id = download.id;
  if (interceptingDownloads.has(id)) return interceptingDownloads.get(id);
  const operation = interceptDownloadNow(download);
  interceptingDownloads.set(id, operation);
  try { return await operation; } finally { interceptingDownloads.delete(id); }
}
async function interceptDownloadNow(download) {
  const id = download.id, url = download.finalUrl || download.url;
  if (!Number.isInteger(id) || !validUrl(url) || url.startsWith(endpoint) || download.state !== 'in_progress') return;
  if (await pendingDownload(id)) return;
  const linkContext = takeBrowserLinkContext(download);
  const record = { id, url, filename: downloadFilename(download), mime: download.mime || '', totalBytes: download.totalBytes > 0 ? download.totalBytes : null, referrer: validUrl(linkContext?.referrer) ? linkContext.referrer : validUrl(download.referrer) ? download.referrer : '', tabId: Number.isInteger(linkContext?.tabId) && linkContext.tabId >= 0 ? linkContext.tabId : Number.isInteger(download.tabId) && download.tabId >= 0 ? download.tabId : -1, createdAt: Date.now(), windowId: null, infoTabId: null, action: null };
  let paused = false;
  try {
    await savePendingDownload(record);
    await chrome.downloads.pause(id); paused = true;
    const credentials = linkContext?.credentials || await credentialsFor(record.tabId, url);
    if (Object.keys(credentials).length) await chrome.storage.session?.set({ [downloadCredentialKey(id)]: { headers: credentials, time: Date.now() } });
    Object.assign(record, { state: 'paused', action: null }, await openDownloadInfo(id));
    await savePendingDownload(record);
  } catch (error) {
    await removePendingDownload(id).catch(() => {});
    if (paused) await chrome.downloads.resume(id).catch(() => {});
    await chrome.storage.local.set({ lastError: error.message }).catch(() => {});
  }
}
async function capturedCredentials(id, record) {
  const key = downloadCredentialKey(id);
  const stored = typeof chrome.storage.session?.get === 'function' ? (await chrome.storage.session.get(key))[key] : null;
  if (stored?.headers) return stored.headers;
  return credentialsFor(record.tabId, record.url);
}
async function startCapturedDownload(id) {
  const record = await capturedDownloadInfo(id);
  record.action = 'starting'; await savePendingDownload(record);
  try {
    const item = await downloadItem(id);
    if (item?.state === 'in_progress') await chrome.downloads.pause(id);
    const headers = await capturedCredentials(id, record);
    const data = await api('/api/downloads', { url: record.url, filename: record.filename, headers: { ...headers, referer: record.referrer || '' } });
    await chrome.downloads.cancel(id).catch(() => {});
    await removePendingDownload(id);
    await chrome.storage.local.set({ lastError: '' });
    return data;
  } catch (error) {
    record.action = null; await savePendingDownload(record).catch(() => {});
    throw error;
  }
}
async function resumeCapturedDownload(id) {
  const record = await pendingDownload(id);
  if (!record) return { resumed: false };
  record.action = 'resuming'; await savePendingDownload(record);
  await chrome.downloads.resume(id).catch(() => {});
  await removePendingDownload(id);
  return { resumed: true };
}
async function pendingDownloadRecords() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([key, value]) => key.startsWith(downloadInfoPrefix) && value?.id !== undefined).map(([, value]) => value);
}
async function recoverCapturedDownloads() {
  for (const record of await pendingDownloadRecords()) {
    try {
      const item = await downloadItem(record.id);
      if (!item || ['complete', 'interrupted'].includes(item.state)) { await removePendingDownload(record.id); continue; }
      if (record.windowId) { try { await chrome.windows.get(record.windowId); continue; } catch {} }
      if (record.infoTabId) { try { await chrome.tabs.get(record.infoTabId); continue; } catch {} }
      if (item.state === 'in_progress') await chrome.downloads.pause(record.id);
      Object.assign(record, { state: 'paused', action: null }, await openDownloadInfo(record.id));
      await savePendingDownload(record);
    } catch {}
  }
}
function captureCredentials(details) {
  if (details.tabId < 0 || !validUrl(details.url)) return;
  const headers = {};
  for (const item of details.requestHeaders || []) {
    const name = String(item.name || '').toLowerCase();
    if (!credentialHeaders.includes(name) || typeof item.value !== 'string' || /[\r\n]/.test(item.value)) continue;
    const value = item.value.slice(0, credentialLimit[name] || 2048);
    if (value) headers[name] = value;
  }
  if (!Object.keys(headers).some(name => ['cookie', 'authorization'].includes(name))) return;
  let origin; try { origin = new URL(details.url).origin; } catch { return; }
  modify(async () => {
    const key = `credentials:${details.tabId}`;
    const stored = (await chrome.storage.session.get(key))[key] || {};
    const now = Date.now();
    for (const [entryOrigin, record] of Object.entries(stored)) if (!record?.time || now - record.time > credentialTtl) delete stored[entryOrigin];
    stored[origin] = { time: now, headers };
    const origins = Object.entries(stored).sort((a, b) => b[1].time - a[1].time).slice(0, 12);
    await chrome.storage.session.set({ [key]: Object.fromEntries(origins) });
  }).catch(() => {});
}
function isoDuration(value) {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value || '').trim());
  if (!match) return null;
  return (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0) || null;
}
function xmlText(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }
function hlsMediaInfo(text) {
  let duration = 0, segments = 0, drm = false;
  for (const line of String(text).split(/\r?\n/).map(line => line.trim())) {
    const upper = line.toUpperCase();
    if (upper.startsWith('#EXT-X-KEY:') || upper.startsWith('#EXT-X-SESSION-KEY:')) {
      const info = attributes(line.slice(line.indexOf(':') + 1));
      const method = String(info.METHOD || '').toUpperCase();
      const keyFormat = String(info.KEYFORMAT || 'identity').toLowerCase();
      if (method === 'SAMPLE-AES' || (keyFormat && keyFormat !== 'identity')) drm = true;
    }
    if (!upper.startsWith('#EXTINF:')) continue;
    const value = Number(line.slice(line.indexOf(':') + 1).split(',')[0]);
    if (Number.isFinite(value) && value > 0) { duration += value; segments++; }
  }
  return { duration: duration > 0 ? duration : null, segments, drm };
}
function hlsVariants(text, manifestUrl) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim());
  const audioGroups = {};
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('#EXT-X-MEDIA:')) continue;
    const info = attributes(line.slice(line.indexOf(':') + 1));
    if (String(info.TYPE || '').toUpperCase() !== 'AUDIO' || !info.URI || !info['GROUP-ID']) continue;
    try { audioGroups[info['GROUP-ID']] = new URL(info.URI, manifestUrl).href; } catch {}
  }
  const variants = [], drm = lines.some(line => /^#EXT-X-(?:KEY|SESSION-KEY):/i.test(line) && (() => { const info = attributes(line.slice(line.indexOf(':') + 1)); return String(info.METHOD || '').toUpperCase() === 'SAMPLE-AES' || String(info.KEYFORMAT || 'identity').toLowerCase() !== 'identity'; })());
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].toUpperCase().startsWith('#EXT-X-STREAM-INF:')) continue;
    const info = attributes(lines[index].slice(lines[index].indexOf(':') + 1));
    let uri = ''; for (let next = index + 1; next < lines.length; next++) { if (lines[next] && !lines[next].startsWith('#')) { uri = lines[next]; break; } }
    if (!uri) continue;
    let url; try { url = new URL(uri, manifestUrl).href; } catch { continue; }
    const resolution = /^(\d+)x(\d+)$/i.exec(info.RESOLUTION || '');
    variants.push({ url, stream: true, variant: true, drm, manifestType: 'HLS', mime: 'application/vnd.apple.mpegurl', width: number(resolution?.[1]), height: number(resolution?.[2]), bandwidth: number(info.BANDWIDTH), averageBandwidth: number(info['AVERAGE-BANDWIDTH']), codecs: info.CODECS || '', audioUrl: audioGroups[info.AUDIO] || null, frameId: null, source: 'manifest' });
  }
  return variants;
}
function dashVariants(text, manifestUrl) {
  const source = String(text);
  const globalBase = xmlText(/<MPD\b[^>]*>[\s\S]*?<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i.exec(source)?.[1]);
  const presentationDuration = isoDuration(/<MPD\b[^>]*\bmediaPresentationDuration="([^"]+)"/i.exec(source)?.[1]);
  const drm = /<ContentProtection\b/i.test(source);
  const adaptations = [];
  const adaptationPattern = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
  let adaptation;
  while ((adaptation = adaptationPattern.exec(source))) {
    const setAttrs = attributes(adaptation[1]), block = adaptation[2];
    const setBase = xmlText(/<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i.exec(block)?.[1]);
    const reps = [], representationPattern = /<Representation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Representation>)/gi;
    let representation;
    while ((representation = representationPattern.exec(block))) {
      const repAttrs = attributes(representation[1]), repBlock = representation[2] || '';
      const base = xmlText(/<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i.exec(repBlock)?.[1]) || setBase || globalBase;
      let url; try { url = new URL(base || manifestUrl, manifestUrl).href; } catch { continue; }
      const mime = repAttrs.MIMETYPE || setAttrs.MIMETYPE || (String(repAttrs.CODECS || setAttrs.CODECS || '').toLowerCase().startsWith('mp4a') ? 'audio/mp4' : 'video/mp4');
      reps.push({ url, mime, width: number(repAttrs.WIDTH || setAttrs.WIDTH), height: number(repAttrs.HEIGHT || setAttrs.HEIGHT), bandwidth: number(repAttrs.BANDWIDTH), codecs: repAttrs.CODECS || setAttrs.CODECS || '' });
    }
    adaptations.push({ attrs: setAttrs, reps, audio: /audio/i.test(setAttrs.MIMETYPE || setAttrs.CONTENTTYPE || '') || reps.every(rep => !rep.width && !rep.height && /^(audio|mp4a)/i.test(rep.codecs || rep.mime)) });
  }
  const audio = adaptations.filter(set => set.audio).flatMap(set => set.reps).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  return adaptations.filter(set => !set.audio).flatMap(set => set.reps.map(rep => ({ ...rep, duration: presentationDuration, drm, stream: true, variant: true, manifestType: 'DASH', audioUrl: audio?.url || null, frameId: null, source: 'manifest' })));
}
async function readHlsVariant(variant, referrer, tabId) {
  try {
    const credentials = await credentialsFor(tabId, variant.url);
    const response = await fetch(variant.url, { credentials: 'include', headers: credentials.authorization ? { authorization: credentials.authorization } : {}, cache: 'no-store', referrer: validUrl(referrer) ? referrer : undefined, signal: AbortSignal.timeout(5000) });
    const length = Number(response.headers.get('content-length') || 0);
    if (!response.ok || length > 2 * 1024 * 1024) return variant;
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024 || !/#EXTINF:/i.test(text)) return variant;
    const info = hlsMediaInfo(text);
    const bitrate = variant.averageBandwidth || variant.bandwidth;
    const estimatedSize = info.duration && bitrate ? Math.round(info.duration * bitrate / 8) : null;
    return { ...variant, drm: variant.drm || info.drm, duration: info.duration || variant.duration || null, size: variant.size || estimatedSize, sizeEstimated: !variant.size && Boolean(estimatedSize), segmentCount: info.segments };
  } catch { return variant; }
}
async function readManifest(entry, referrer, tabId) {
  if (!entry?.stream || !validUrl(entry.url)) return [];
  const cached = manifestCache.get(entry.url);
  if (cached && Date.now() - cached.time < manifestTtl) return cached.items;
  let response;
  try {
    const credentials = await credentialsFor(tabId, entry.url);
    response = await fetch(entry.url, { credentials: 'include', headers: credentials.authorization ? { authorization: credentials.authorization } : {}, cache: 'no-store', referrer: validUrl(referrer) ? referrer : undefined, signal: AbortSignal.timeout(5000) });
    const length = Number(response.headers.get('content-length') || 0);
    if (!response.ok || length > 2 * 1024 * 1024) throw new Error('manifest unavailable');
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('manifest too large');
    const type = /\.mpd(?:[?#]|$)/i.test(entry.url) || /dash\+xml/i.test(response.headers.get('content-type') || '') ? 'DASH' : 'HLS';
    let items = type === 'DASH' ? dashVariants(text, entry.url) : hlsVariants(text, entry.url);
    if (type === 'HLS') items = await Promise.all(items.slice(0, 40).map(item => readHlsVariant(item, referrer, tabId)));
    for (const item of items) {
      const bitrate = item.averageBandwidth || item.bandwidth;
      if (!item.size && item.duration && bitrate) { item.size = Math.round(item.duration * bitrate / 8); item.sizeEstimated = true; }
    }
    manifestCache.set(entry.url, { time: Date.now(), items });
    return items;
  } catch { manifestCache.set(entry.url, { time: Date.now(), items: [] }); return []; }
}

async function api(route, body) {
  const { token } = await chrome.storage.local.get('token');
  if (!token) throw new Error('Hubungkan ekstensi dengan kode pairing dari aplikasi lokal.');
  let response;
  try { response = await fetch(endpoint + route, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Zivar-Client': 'extension' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(route === '/api/youtube/formats' ? 200000 : 10000) }); }
  catch { throw new Error('Aplikasi lokal belum terhubung. Buka ZIVAR.exe terlebih dahulu.'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Aplikasi menolak permintaan.'); return data;
}
async function browserDownloadRules() {
  if (Date.now() - browserRulesCache.time < browserRulesTtl) return browserRulesCache;
  try {
    const settings = await api('/api/settings');
    browserRulesCache = {
      time: Date.now(),
      types: normalizedBrowserRuleList(settings.browserDownloadTypes, defaultBrowserDownloadTypes, /^[A-Z0-9]{1,12}\*?$/),
      siteExclusions: normalizedBrowserRuleList(settings.browserDownloadSiteExclusions, defaultBrowserDownloadSiteExclusions, /^(?:\*\.)?[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*$/),
    };
  } catch {}
  return browserRulesCache;
}
async function shouldCaptureBrowserDownload(download) {
  const rules = await browserDownloadRules();
  return !browserDownloadSiteExcluded(download, rules.siteExclusions) && browserDownloadTypeMatches(download, rules.types);
}
function cleanDownloadFilename(value) {
  const filename = String(value || '').split(/[\\/]/).pop().replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  return filename ? filename.slice(0, 180) : '';
}
function downloadOptionsForLink(url, filename, headers = {}) {
  const options = { url, saveAs: false, conflictAction: 'uniquify' };
  const safeFilename = cleanDownloadFilename(filename);
  if (safeFilename) options.filename = safeFilename;
  const requestHeaders = Object.entries(headers)
    .filter(([name, value]) => credentialHeaders.includes(name.toLowerCase()) && typeof value === 'string' && value && !/[\r\n]/.test(value))
    .map(([name, value]) => ({ name, value: value.slice(0, credentialLimit[name.toLowerCase()] || 2048) }));
  if (requestHeaders.length) options.headers = requestHeaders;
  return options;
}
async function startBrowserLinkDownload(message, sender) {
  const url = String(message.url || '');
  if (!validUrl(url)) throw new Error('Tautan download tidak valid.');
  const filename = cleanDownloadFilename(message.filename);
  const probe = { url, finalUrl: url, filename, tabId: sender.tab.id };
  const { captureDownloads = true } = await chrome.storage.local.get('captureDownloads');
  const capture = captureDownloads && await shouldCaptureBrowserDownload(probe);
  const credentials = await credentialsFor(sender.tab.id, url);
  if (capture) registerBrowserLinkContext(url, filename || downloadFilename(probe), { tabId: sender.tab.id, referrer: String(message.referrer || ''), credentials });
  try {
    const id = await chrome.downloads.download(downloadOptionsForLink(url, filename, { ...credentials, referer: String(message.referrer || '') }));
    if (capture) {
      const key = browserLinkContextKey(url, filename || downloadFilename(probe));
      const queue = browserLinkContexts.get(key) || [];
      const context = queue.find(item => !item.claimed);
      if (context) {
        const index = queue.indexOf(context); queue.splice(index, 1);
        if (queue.length) browserLinkContexts.set(key, queue); else browserLinkContexts.delete(key);
        browserLinkContextById.set(id, context);
      }
    }
    return id;
  } catch (error) {
    // Some Chromium versions reject one of the forwarded request headers. The
    // browser still has the right cookies, so retry without custom headers.
    if (!Object.keys(credentials).length && !message.referrer) throw error;
    const id = await chrome.downloads.download(downloadOptionsForLink(url, filename));
    if (capture) {
      const key = browserLinkContextKey(url, filename || downloadFilename(probe));
      const queue = browserLinkContexts.get(key) || [];
      const context = queue.find(item => !item.claimed);
      if (context) {
        const index = queue.indexOf(context); queue.splice(index, 1);
        if (queue.length) browserLinkContexts.set(key, queue); else browserLinkContexts.delete(key);
        browserLinkContextById.set(id, context);
      }
    }
    return id;
  }
}
// ---- Browser-assisted downloads ------------------------------------------------
// Some CDNs (e.g. vidio.com on Akamai) answer only real browsers and return 403 to
// ZIVAR/FFmpeg. In that case Chrome itself downloads the file in 8 MB ranges and
// uploads each piece to the local app. Plans survive service-worker restarts.
const CHUNK = 8 * 1024 * 1024;
const runningBrowserJobs = new Set();
const activeStatus = status => status === 'downloading' || status === 'queued';
async function apiRaw(route, bytes) {
  const { token } = await chrome.storage.local.get('token');
  let response;
  try { response = await fetch(endpoint + route, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Zivar-Client': 'extension' }, body: bytes, signal: AbortSignal.timeout(60000) }); }
  catch { throw new Error('Aplikasi lokal tidak merespons saat menerima data.'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Aplikasi menolak data.'); return data;
}
async function browserPlans() { return (await chrome.storage.local.get('browserJobs')).browserJobs || {}; }
function savePlan(id, plan) {
  return modify(async () => { const all = await browserPlans(); if (plan) all[id] = plan; else delete all[id]; await chrome.storage.local.set({ browserJobs: all }); });
}
async function blockedForApp(url, headers) {
  try { const result = await api('/api/probe', { url, headers }); return [401, 403].includes(result.status); } catch { return false; }
}
async function startBrowserJob({ filename, parts, pageUrl }) {
  const state = await api('/api/browser-jobs', { filename, parts, pageUrl });
  await savePlan(state.id, { parts, pageUrl });
  runBrowserJob(state.id);
  return state;
}
async function uploadStream(id, key, response) {
  const total = Number(response.headers.get('content-length')) || null;
  const reader = response.body.getReader();
  let offset = 0, pieces = [], size = 0, state;
  const flush = async () => {
    const bytes = new Blob(pieces); pieces = []; size = 0;
    state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${key}&offset=${offset}${total ? `&total=${total}` : ''}`, bytes);
    if (state.conflict) throw new Error('Urutan data tidak cocok. Klik Lanjut di aplikasi untuk mencoba lagi.');
    offset += bytes.size;
  };
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    pieces.push(value); size += value.byteLength;
    if (size >= CHUNK) { await flush(); if (!activeStatus(state.status)) { await reader.cancel().catch(() => {}); return state; } }
  }
  if (size) await flush();
  if (!total) await flush(); // empty piece = "file ended here" when the size was unknown
  return state;
}
const expiredHint = status => `Server video membalas HTTP ${status}. Tautan mungkin kedaluwarsa — pilih "Perbarui alamat unduhan" di ZIVAR, lalu klik Unduh lagi di halaman videonya.`;
function fetchRange(url, offset) {
  return fetch(url, { headers: { range: `bytes=${offset}-${offset + CHUNK - 1}` }, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(120000) })
    .then(async response => {
      if (response.status === 200 && offset === 0) return { stream: response };
      if (response.status !== 206) { await response.body?.cancel().catch(() => {}); throw new Error(response.status === 200 ? 'Server tidak mendukung melanjutkan unduhan dari tengah file.' : expiredHint(response.status)); }
      const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== offset) throw new Error('Server mengirim bagian file yang salah.');
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) throw new Error('Server video tidak mengirim data.');
      return { bytes, total: range[3] === '*' ? null : Number(range[3]) };
    }, () => { throw new Error('Koneksi ke server video terputus. Klik Lanjut untuk mencoba lagi.'); });
}
// Plain file: while one piece is being handed to the app, the next one is already downloading.
async function downloadRanges(id, source, state) {
  let part = state.parts.find(item => item.key === source.key);
  let offset = part.received, next = part.total && offset >= part.total ? null : fetchRange(source.url, offset);
  while (next) {
    const piece = await next; next = null;
    if (piece.stream) return uploadStream(id, source.key, piece.stream);
    const end = offset + piece.bytes.byteLength, more = piece.total ? end < piece.total : piece.bytes.byteLength >= CHUNK;
    const prefetch = more ? fetchRange(source.url, end) : null; prefetch?.catch(() => {});
    state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=${offset}${piece.total ? `&total=${piece.total}` : ''}`, piece.bytes);
    if (state.conflict) throw new Error('Urutan data tidak cocok. Klik Lanjut di aplikasi untuk mencoba lagi.');
    if (!piece.total && !more) state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=${end}`, new Blob([]));
    if (!activeStatus(state.status)) return state;
    offset = end; next = prefetch;
  }
  return state;
}
// ---- HLS (.m3u8) through the browser ----
function hlsAttributes(text) { const result = {}; String(text).replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g, (_, key, value) => { result[key] = value.replace(/^"|"$/g, ''); return _; }); return result; }
function parseMediaPlaylist(text, baseUrl) {
  if (!/^#EXTM3U/.test(text.trim())) throw new Error('Playlist HLS tidak valid.');
  if (/#EXT-X-STREAM-INF/i.test(text)) throw new Error('Pilih salah satu kualitas, bukan daftar kualitasnya.');
  const lines = text.split(/\r?\n/).map(line => line.trim());
  let sequence = 0, key = null, init = null, pendingRange = null, lastEnd = 0;
  const segments = [];
  const byteRange = (value, previousEnd) => { const [length, start] = value.split('@'); const begin = start !== undefined ? Number(start) : previousEnd; return { start: begin, end: begin + Number(length) - 1 }; };
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const info = hlsAttributes(line.slice(11)), method = (info.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE') key = null;
      else if (method === 'AES-128' && (!info.KEYFORMAT || info.KEYFORMAT === 'identity')) key = { uri: new URL(info.URI, baseUrl).href, iv: info.IV || null };
      else throw new Error('Video ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const info = hlsAttributes(line.slice(11));
      init = { url: new URL(info.URI, baseUrl).href, range: info.BYTERANGE ? byteRange(info.BYTERANGE, 0) : null };
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) pendingRange = line.slice(17);
    else if (line && !line.startsWith('#')) {
      const range = pendingRange ? byteRange(pendingRange, lastEnd) : null; pendingRange = null;
      if (range) lastEnd = range.end + 1;
      segments.push({ url: new URL(line, baseUrl).href, range, key, sequence: sequence + segments.length });
    }
  }
  if (!segments.length) throw new Error('Playlist HLS tidak berisi segmen.');
  return { segments, init };
}
const hexBytes = hex => Uint8Array.from(hex.replace(/^0x/i, '').padStart(32, '0').match(/../g).map(byte => parseInt(byte, 16)));
async function fetchBytes(url, range) {
  let response;
  try { response = await fetch(url, { headers: range ? { range: `bytes=${range.start}-${range.end}` } : {}, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(120000) }); }
  catch { throw new Error('Koneksi ke server video terputus. Klik Lanjut untuk mencoba lagi.'); }
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(expiredHint(response.status)); }
  return new Uint8Array(await response.arrayBuffer());
}
async function downloadHls(id, source, state, plan) {
  const text = new TextDecoder().decode(await fetchBytes(source.url));
  const { segments, init } = parseMediaPlaylist(text, source.url);
  const keys = new Map();
  const keyFor = async key => { if (!keys.has(key.uri)) keys.set(key.uri, fetchBytes(key.uri).then(raw => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']))); return keys.get(key.uri); };
  const segmentBytes = async segment => {
    const raw = await fetchBytes(segment.url, segment.range);
    if (!segment.key) return raw;
    const iv = segment.key.iv ? hexBytes(segment.key.iv) : (() => { const value = new Uint8Array(16); new DataView(value.buffer).setUint32(12, segment.sequence); return value; })();
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, await keyFor(segment.key), raw));
  };
  // Resume only from a point we recorded ourselves; otherwise start this track again.
  const part = state.parts.find(item => item.key === source.key);
  const saved = plan.hls?.[source.key];
  let index = 0, offset = 0;
  if (part.received && saved && saved.bytes === part.received && saved.segment <= segments.length) ({ segment: index, bytes: offset } = saved);
  else if (part.received) { state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=0&restart=1`, new Blob([])); }
  if (part.total && part.received === part.total) return state;
  const record = async (segment, bytes) => { plan.hls = { ...(plan.hls || {}), [source.key]: { segment, bytes } }; await savePlan(id, plan); };
  if (index === 0 && init) { const bytes = await fetchBytes(init.url, init.range); state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=0`, bytes); offset = bytes.byteLength; if (state.conflict) throw new Error('Urutan data tidak cocok.'); }
  // Up to 4 segments download at once; they are handed to the app in order, ~4 MB per upload.
  const pending = []; let cursor = index;
  const fill = () => { while (pending.length < 4 && cursor < segments.length) { const promise = segmentBytes(segments[cursor++]); promise.catch(() => {}); pending.push(promise); } };
  while (index < segments.length) {
    const pieces = []; let size = 0, taken = 0;
    while (index + taken < segments.length && size < 4 * 1024 * 1024) {
      fill();
      const bytes = await pending.shift(); taken++; pieces.push(bytes); size += bytes.byteLength;
    }
    fill();
    state = await apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=${offset}`, new Blob(pieces));
    if (state.conflict) throw new Error('Urutan data tidak cocok. Klik Lanjut di aplikasi untuk mencoba lagi.');
    index += taken; offset += size; await record(index, offset);
    if (!activeStatus(state.status)) return state;
  }
  return apiRaw(`/api/browser-jobs/${id}/chunk?part=${source.key}&offset=${offset}`, new Blob([]));
}
async function runBrowserJob(id) {
  if (runningBrowserJobs.has(id)) return;
  runningBrowserJobs.add(id);
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    const plan = (await browserPlans())[id]; if (!plan) return;
    let state = await api(`/api/browser-jobs/${id}`);
    for (const source of plan.parts) {
      if (!activeStatus(state.status)) return;
      state = source.hls ? await downloadHls(id, source, state, plan) : await downloadRanges(id, source, state);
    }
    if (activeStatus(state.status)) await api(`/api/browser-jobs/${id}/finish`, {});
  } catch (error) {
    await api(`/api/browser-jobs/${id}/fail`, { error: error.message }).catch(() => {});
  } finally { clearInterval(keepAlive); runningBrowserJobs.delete(id); }
}
// Picks up jobs after "Lanjut" in the app, a Chrome restart, or a service-worker restart.
async function resumeBrowserJobs() {
  for (const id of Object.keys(await browserPlans())) {
    let state;
    try { state = await api(`/api/browser-jobs/${id}`); }
    catch (error) { if (/tidak ditemukan/i.test(error.message)) await savePlan(id, null); continue; }
    if (state.status === 'completed' || state.status === 'cancelled') await savePlan(id, null);
    else if (activeStatus(state.status)) runBrowserJob(id);
  }
}
chrome.alarms.create('zivar-browser-jobs', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'zivar-browser-jobs') return;
  resumeBrowserJobs().catch(() => {});
  recoverCapturedDownloads().catch(() => {});
});
resumeBrowserJobs().catch(() => {});
recoverCapturedDownloads().catch(() => {});

async function remember(tabId, item) {
  if (tabId < 0 || !validUrl(item.url) || item.url.startsWith(endpoint)) return;
  await modify(async () => {
    const key = `media:${tabId}`;
    const stored = await chrome.storage.session.get(key);
    const list = stored[key] || [];
    const index = list.findIndex(entry => entry.url === item.url);
    const previous = list[index];
    const stream = streamPattern.test(item.url) || /mpegurl|dash\+xml/i.test(item.mime || previous?.mime || '');
    if (/\.(m4s|ts)(?:[?#]|$)/i.test(item.url) && !stream) return;
    const frameIds = [...new Set([...(previous?.frameIds || []), item.frameId ?? 0])].slice(-16);
    const record = { ...previous, ...item, stream, frameIds, ad: isAd(item.url), detectedAt: Date.now() };
    if (index >= 0) list[index] = record; else list.unshift(record);
    await chrome.storage.session.set({ [key]: list.slice(0, 40) });
    await chrome.action.setBadgeText({ tabId, text: list.length ? String(Math.min(list.length, 40)) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#245b91' });
    if (!previous || previous.stream !== stream || !previous.frameIds?.includes(item.frameId ?? 0)) {
      chrome.tabs.sendMessage(tabId, { type: 'MEDIA_UPDATED' }, { frameId: item.frameId ?? 0 }).catch(() => {});
    }
  });
}
function videoSender(sender) {
  return sender.id === chrome.runtime.id && sender.tab?.id >= 0 && validUrl(sender.url);
}
function youtubePage(value) {
  try { const u = new URL(value); return /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(u.hostname) && (u.searchParams.get('v') || /^\/(shorts|embed|live)\//.test(u.pathname)) ? u.href : null; } catch { return null; }
}
async function videoCandidates(sender) {
  const youtube = youtubePage(sender.url) || youtubePage(sender.tab?.url);
  if (youtube) {
    const data = await api('/api/youtube/formats', { url:youtube });
    return { items:data.formats.map(f => ({ ...f, url:data.url + '#format=' + encodeURIComponent(f.formatId), pageUrl:data.url, title:data.title, youtube:true, stream:true, variant:true, manifestType:'YouTube MP4', mime:'video/mp4' })) };
  }
  const key = `media:${sender.tab.id}`;
  const entries = (await chrome.storage.session.get(key))[key] || [];
  const relevant = entries.filter(item => item.frameIds?.includes(sender.frameId ?? 0) && (item.kind === 'video' || /^video\//i.test(item.mime || '') || videoPattern.test(item.url) || item.stream));
  const ads = relevant.filter(item => item.ad || isAd(item.url));
  const scoped = relevant.filter(item => !ads.includes(item)).slice(0, 20);
  const items = [];
  for (const entry of scoped) {
    items.push(entry);
    if (entry.stream) for (const variant of await readManifest(entry, sender.url, sender.tab.id)) {
      const observed = entries.find(item => item.url === variant.url);
      items.push({ ...entry, ...variant, size: observed?.size || variant.size || null, sizeEstimated: observed?.size ? false : Boolean(variant.sizeEstimated), frameIds: entry.frameIds, manifestUrl: entry.url, title: entry.title });
    }
  }
  const unique = [...new Map(items.filter(item => !isAd(item.url)).map(item => [item.url, item])).values()].slice(0, 40);
  return { items: unique, adsOnly: !unique.length && ads.length > 0 };
}
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') chrome.storage.local.get('captureDownloads').then(data => { if (data.captureDownloads === undefined) return chrome.storage.local.set({ captureDownloads: true }); }).catch(() => {});
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'zivar-download', title: 'Unduh dengan ZIVAR', contexts: ['link', 'video', 'audio'] }));
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'zivar-download') return;
  try {
    const url = info.linkUrl || info.srcUrl;
    const credentials = await credentialsFor(tab?.id ?? -1, url);
    await api('/api/downloads', { url, headers: { ...credentials, referer: tab?.url || '' } });
    await chrome.storage.local.set({ lastMessage: 'Tautan dikirim ke ZIVAR.', lastError: '' });
    if (tab?.id >= 0) chrome.tabs.sendMessage(tab.id, { type: 'TOAST', text: 'Tautan dikirim ke ZIVAR.' }).catch(() => {});
  } catch (error) {
    await chrome.storage.local.set({ lastError: error.message });
    if (tab?.id >= 0) chrome.tabs.sendMessage(tab.id, { type: 'TOAST', text: error.message }).catch(() => {});
    chrome.action.setBadgeText({ text: '!' });
  }
});
// "extraHeaders" (needed in Chrome to see Cookie) does not exist in Firefox, where it would throw.
try { chrome.webRequest.onBeforeSendHeaders.addListener(captureCredentials, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders', 'extraHeaders']); }
catch { chrome.webRequest.onBeforeSendHeaders.addListener(captureCredentials, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders']); }
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  const headers = details.responseHeaders || [];
  const mime = headers.find(header => header.name.toLowerCase() === 'content-type')?.value || '';
  if (!mediaTypes.test(mime) && !directPattern.test(details.url) && !streamPattern.test(details.url)) return;
  const total = /\/(\d+)$/.exec(headers.find(header => header.name.toLowerCase() === 'content-range')?.value || '');
  remember(details.tabId, { url: details.url, mime, size: Number(total?.[1] || headers.find(header => header.name.toLowerCase() === 'content-length')?.value) || null, source: 'network', frameId: details.frameId }).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') modify(async () => { await chrome.storage.session.remove([`media:${tabId}`, `credentials:${tabId}`]); await chrome.action.setBadgeText({ tabId, text: '' }); }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => modify(() => chrome.storage.session.remove([`media:${tabId}`, `credentials:${tabId}`])).catch(() => {}));

// onCreated is the fallback for downloads started by navigation, scripts, forms,
// and browser features that a content script cannot see. A click intercepted by
// content.js starts through downloads.download({ saveAs: false }) instead, so the
// browser's own Save As preference never gets a chance to open a second dialog.
if (chrome.downloads.onDeterminingFilename?.addListener) {
  chrome.downloads.onDeterminingFilename.addListener((download, suggest) => {
    (async () => {
      const { captureDownloads = true } = await chrome.storage.local.get('captureDownloads');
      const rules = browserRulesCache.time ? browserRulesCache : { types: defaultBrowserDownloadTypes, siteExclusions: defaultBrowserDownloadSiteExclusions };
      if (captureDownloads && !browserDownloadSiteExcluded(download, rules.siteExclusions) && browserDownloadTypeMatches(download, rules.types)) await interceptDownload(download);
    })().catch(() => {}).finally(() => suggest());
    return true;
  });
}
chrome.downloads.onCreated.addListener(async download => {
  const { captureDownloads = true } = await chrome.storage.local.get('captureDownloads');
  if (!captureDownloads) return;
  if (!await shouldCaptureBrowserDownload(download)) return;
  await interceptDownload(download);
});
chrome.windows.onRemoved.addListener(windowId => pendingDownloadRecords().then(async records => {
  for (const record of records) if (record.windowId === windowId && !record.action) await resumeCapturedDownload(record.id).catch(() => {});
}).catch(() => {}));
chrome.tabs.onRemoved.addListener(tabId => pendingDownloadRecords().then(async records => {
  for (const record of records) if (record.infoTabId === tabId && !record.action) await resumeCapturedDownload(record.id).catch(() => {});
}).catch(() => {}));
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    if (message.type === 'MEDIA' && videoSender(sender)) {
      for (const item of (message.items || []).slice(0, 30)) await remember(sender.tab.id, { url: item.url, source: 'player', title: String(item.title || '').slice(0, 200), kind: item.kind === 'video' ? 'video' : 'audio', width: number(item.width), height: number(item.height), duration: number(item.duration), codec: typeof item.codec === 'string' ? item.codec.slice(0, 200) : null, frameId: sender.frameId ?? 0 });
      return { ok: true };
    }
    if (message.type === 'VIDEO_CANDIDATES' && videoSender(sender)) return { ok: true, ...await videoCandidates(sender) };
    if (message.type === 'VIDEO_DOWNLOAD' && videoSender(sender)) {
      const candidates = await videoCandidates(sender);
      if (candidates.reason) throw new Error(candidates.reason);
      const candidate = candidates.items.find(item => item.url === message.url);
      if (!candidate) throw new Error('Media belum terdeteksi untuk pemutar ini. Muat ulang halaman dan putar videonya.');
      if (candidate.drm) throw new Error('Media ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.');
      if (candidate.youtube) {
        const data = await api('/api/downloads', { url:candidate.pageUrl, youtubeFormat:candidate.formatId, filename:candidate.title + '-' + candidate.height + 'p.mp4' });
        return { ok:true, id:data.id, filename:data.filename };
      }
      if (candidate.variant) {
        const quality = candidate.height ? `-${candidate.height}p` : '';
        const base = String(candidate.title || sender.tab?.title || 'video').replace(/\.[^.]+$/, '').slice(0, 120) || 'video';
        const credentials = await credentialsFor(sender.tab.id, candidate.url);
        const audioCredentials = candidate.audioUrl ? await credentialsFor(sender.tab.id, candidate.audioUrl) : {};
        // Single-file DASH (one .mp4/.m4s per quality) can be fetched by Chrome itself
        // when the CDN refuses ZIVAR.
        const singleFiles = candidate.manifestType === 'DASH' && !streamPattern.test(candidate.url) && candidate.url !== candidate.manifestUrl && (!candidate.audioUrl || !streamPattern.test(candidate.audioUrl));
        if (singleFiles && await blockedForApp(candidate.url, { ...credentials, referer: sender.url })) {
          const parts = [{ key: 'video', url: candidate.url }, ...(candidate.audioUrl ? [{ key: 'audio', url: candidate.audioUrl }] : [])];
          const data = await startBrowserJob({ filename: `${base}${quality}.mp4`, parts, pageUrl: sender.url });
          return { ok: true, id: data.id, filename: data.filename, browser: true };
        }
        // HLS: if the playlist or its segments refuse ZIVAR, Chrome fetches the segments itself.
        if (candidate.manifestType === 'HLS') {
          const headers = { ...credentials, referer: sender.url };
          let blocked = await blockedForApp(candidate.url, headers);
          if (!blocked) {
            try { const first = parseMediaPlaylist(new TextDecoder().decode(await fetchBytes(candidate.url)), candidate.url).segments[0]; blocked = await blockedForApp(first.url, headers); }
            catch (error) { if (/DRM/.test(error.message)) throw error; }
          }
          if (blocked) {
            const parts = [{ key: 'video', url: candidate.url, hls: true }, ...(candidate.audioUrl ? [{ key: 'audio', url: candidate.audioUrl, hls: true }] : [])];
            const data = await startBrowserJob({ filename: `${base}${quality}.mp4`, parts, pageUrl: sender.url });
            return { ok: true, id: data.id, filename: data.filename, browser: true };
          }
        }
        const data = await api('/api/media', { manifestUrl: candidate.manifestUrl || candidate.url, variantUrl: candidate.url, audioUrl: candidate.audioUrl || null, manifestType: candidate.manifestType || 'HLS', filename: `${base}${quality}.mp4`, metadata: { width: candidate.width, height: candidate.height, duration: candidate.duration, bandwidth: candidate.bandwidth, averageBandwidth: candidate.averageBandwidth, codecs: candidate.codecs, size: candidate.size, sizeEstimated: candidate.sizeEstimated }, headers: { ...credentials, referer: sender.url }, audioHeaders: { ...audioCredentials, referer: sender.url } });
        return { ok: true, id: data.id, filename: data.filename };
      }
      if (candidate.stream) throw new Error('Pengunduhan stream HLS/DASH belum didukung.');
      const credentials = await credentialsFor(sender.tab.id, candidate.url);
      if (await blockedForApp(candidate.url, { ...credentials, referer: sender.url })) {
        const data = await startBrowserJob({ filename: null, parts: [{ key: 'file', url: candidate.url }], pageUrl: sender.url });
        return { ok: true, id: data.id, filename: data.filename, browser: true };
      }
      const data = await api('/api/downloads', { url: candidate.url, headers: { ...credentials, referer: sender.url } });
      return { ok: true, id: data.id, filename: data.filename };
    }
    if (message.type === 'BROWSER_DOWNLOAD_RULES' && videoSender(sender)) {
      const rules = await browserDownloadRules();
      return { ok: true, types: rules.types, siteExclusions: rules.siteExclusions };
    }
    if (message.type === 'BROWSER_LINK_DOWNLOAD' && videoSender(sender)) {
      const id = await startBrowserLinkDownload(message, sender);
      return { ok: true, id, browser: true };
    }
    // Content scripts may report media, but only the extension's own pages may
    // pair the app or control a paused browser download.
    const popupUrl = chrome.runtime.getURL('popup.html');
    const downloadInfoUrl = chrome.runtime.getURL('download.html');
    const pageUrl = String(sender.url || '');
    const isPopup = sender.id === chrome.runtime.id && (pageUrl === popupUrl || pageUrl.startsWith(`${popupUrl}?`));
    const isDownloadInfo = sender.id === chrome.runtime.id && (pageUrl === downloadInfoUrl || pageUrl.startsWith(`${downloadInfoUrl}?`));
    if (!isPopup && !isDownloadInfo) throw new Error('Pengirim tidak diizinkan.');
    if (message.type === 'DOWNLOAD_INFO') {
      if (!isDownloadInfo) throw new Error('Pengirim tidak diizinkan.');
      return { ok: true, data: await capturedDownloadInfo(downloadId(message.id)) };
    }
    if (message.type === 'DOWNLOAD_INFO_START') {
      if (!isDownloadInfo) throw new Error('Pengirim tidak diizinkan.');
      return { ok: true, data: await startCapturedDownload(downloadId(message.id)) };
    }
    if (message.type === 'DOWNLOAD_INFO_RESUME') {
      if (!isDownloadInfo) throw new Error('Pengirim tidak diizinkan.');
      return { ok: true, data: await resumeCapturedDownload(downloadId(message.id)) };
    }
    if (!isPopup) throw new Error('Pengirim tidak diizinkan.');
    if (message.type === 'PAIR') {
      if (!/^[a-f0-9]{48}$/.test(message.token || '')) throw new Error('Format kode pairing tidak valid.');
      await chrome.storage.local.set({ token: message.token });
      await api('/api/state'); await chrome.storage.local.set({ lastError: '' }); return { ok: true };
    }
    if (message.type === 'STATUS') { await api('/api/state'); return { ok: true }; }
    if (message.type === 'OPEN_APP') { const data = await api('/api/focus', {}); return { ok: true, data }; }
    if (message.type === 'SEND') {
      const credentials = await credentialsFor(message.tabId ?? -1, message.url);
      const data = await api('/api/downloads', { url: message.url, headers: { ...credentials, referer: message.referrer || '' } });
      return { ok: true, data };
    }
    throw new Error('Pesan tidak dikenali.');
  })().then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});
