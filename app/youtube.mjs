import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from './media.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = () => path.join(process.resourcesPath || path.join(root, 'vendor'), 'yt-dlp');
// The bundled yt-dlp lives in a read-only install folder. An updatable copy is kept
// in the user's data folder; it is used whenever it exists.
let extractorCopy = null;
export function useExtractorDirectory(directory) { extractorCopy = directory ? path.join(directory, 'yt-dlp.exe') : null; }
const extractorExe = () => extractorCopy && existsSync(extractorCopy) ? extractorCopy : path.join(runtime(), 'yt-dlp.exe');
function checkedExtractorExe() {
  const executable = extractorExe();
  if (!existsSync(executable)) throw new Error('Extractor yt-dlp belum tersedia. Instal ulang ZIVAR dengan installer versi terbaru.');
  return executable;
}
function runPlain(exe, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => { out = (out + chunk).slice(-8000); });
    child.stderr.setEncoding('utf8').on('data', chunk => { err = (err + chunk).slice(-8000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error((err || out).trim().split(/\r?\n/).slice(-2).join(' ') || `yt-dlp berhenti dengan kode ${code}`)); });
  });
}
export async function extractorVersion() { try { return await runPlain(checkedExtractorExe(), ['--version'], 30000); } catch { return null; } }
// Copies the bundled extractor to the data folder (first time), then runs yt-dlp's own
// updater, which downloads the official release and checks it against its checksums.
export async function updateExtractor() {
  if (!extractorCopy) throw new Error('Folder extractor belum diatur.');
  await fs.mkdir(path.dirname(extractorCopy), { recursive: true });
  if (!existsSync(extractorCopy)) await fs.copyFile(checkedExtractorExe(), extractorCopy);
  const before = await extractorVersion();
  const output = await runPlain(extractorCopy, ['--ignore-config', '--no-colors', '--update-to', 'stable'], 180000);
  const after = await extractorVersion();
  return { before, after, updated: Boolean(before && after && before !== after), output: output.split(/\r?\n/).slice(-1)[0] || '' };
}
export function youtubeUrl(value) {
  try {
    const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase(); let id;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com','youtube-nocookie.com'].includes(host)) id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[1];
    return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}
const baseArgs = () => {
  const args = ['--ignore-config','--no-playlist','--no-warnings','--no-colors','--no-plugin-dirs','--socket-timeout','20','--retries','2'];
  const nodeRuntime = path.join(runtime(), 'node.exe');
  if (existsSync(nodeRuntime)) args.push('--js-runtimes', `node:${nodeRuntime}`);
  args.push('--ffmpeg-location', path.dirname(ffmpegPath()));
  return args;
};
export function runExtractor(args, { signal, onLine, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    let executable; try { executable = checkedExtractorExe(); } catch (error) { return reject(error); }
    const child = spawn(executable, [...baseArgs(), ...args], { windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] });
    let output = '', error = '', pending = '', failure;
    const stop = () => {
      failure ||= signal?.reason || new Error('Extractor melewati batas waktu. Coba kembali.');
      if (process.platform === 'win32' && child.pid) { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' }); killer.on('error', () => child.kill()); }
      else child.kill();
    };
    const timer = setTimeout(stop, timeout); signal?.addEventListener('abort', stop, { once:true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output = onLine ? (output + chunk).slice(-16000) : output + chunk; if (output.length > 16000000) { failure = new Error('Metadata terlalu besar.'); stop(); } pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) onLine?.(line); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-8000); });
    child.once('error', err => { cleanup(); reject(new Error(`Extractor tidak dapat dijalankan: ${err.message}`)); });
    child.once('close', code => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(error.trim().split(/\r?\n/).slice(-3).join(' ') || 'Extractor gagal membaca video.')); else resolve(output); });
  });
}
export function publicFormats(data) {
  if (data.is_live) throw new Error('Live yang sedang berlangsung belum didukung.');
  // Prefer plain HTTPS files over HLS (m3u8): HTTPS has an exact size and downloads
  // much faster. HLS is kept only for resolutions that have no HTTPS MP4.
  const direct = f => f.protocol === 'https' ? 1 : 0;
  const audio = (data.formats || []).filter(f => !f.has_drm && f.ext === 'm4a' && f.acodec !== 'none').sort((a,b) => direct(b) - direct(a) || (b.abr || 0) - (a.abr || 0))[0];
  const seen = new Set(); const formats = [];
  for (const f of [...(data.formats || [])].sort((a,b) => (b.height || 0)-(a.height || 0) || direct(b)-direct(a) || (b.tbr || 0)-(a.tbr || 0))) {
    if (f.has_drm || f.ext !== 'mp4' || !f.height || !f.vcodec || f.vcodec === 'none' || !/^[\w-]+$/.test(f.format_id)) continue;
    const separate = f.acodec === 'none'; if (separate && !audio) continue;
    if (seen.has(f.height)) continue; seen.add(f.height);
    const exact = f.filesize && (!separate || audio.filesize);
    const estimate = x => x.filesize || x.filesize_approx || (x.tbr && data.duration ? Math.round(x.tbr * 1000 * data.duration / 8) : null);
    const videoSize = estimate(f), audioSize = separate ? estimate(audio) : 0;
    const size = videoSize && (!separate || audioSize) ? videoSize + audioSize : null;
    formats.push({ formatId: f.format_id + (separate ? `+${audio.format_id}` : ''), height:f.height, width:f.width, codecs:[f.vcodec,separate?audio.acodec:f.acodec].join(', '), bandwidth:((f.tbr || 0)+(separate?audio.abr || 0:0))*1000, size:size || null, sizeEstimated:!exact, duration:data.duration });
  }
  if (!formats.length) throw new Error('Tidak ada format MP4 tanpa DRM yang dapat diakses.');
  return { title: data.title || 'YouTube video', duration:data.duration, formats };
}
const cache = new Map();
export async function inspectYoutube(value) {
  const url = youtubeUrl(value); if (!url) throw new Error('URL video YouTube tidak valid.');
  const old = cache.get(url); if (old && old.expires > Date.now()) return old.promise;
  if (cache.size >= 20) cache.delete(cache.keys().next().value);
  const promise = runExtractor(['--dump-single-json','--skip-download','--',url]).then(text => ({ url, ...publicFormats(JSON.parse(text)) }));
  cache.set(url, { expires:Date.now()+60000, promise }); promise.catch(() => cache.delete(url)); return promise;
}
// Named choices that work for any video (used by playlists and the audio options).
const capped = height => `bv[height<=${height}][ext=mp4][protocol=https]+ba[ext=m4a][protocol=https]/bv[height<=${height}][ext=mp4]+ba[ext=m4a]/b[height<=${height}][ext=mp4]/b[height<=${height}]`;
export const YOUTUBE_PRESETS = {
  'audio-m4a': { label: 'Audio saja (M4A)', format: 'ba[ext=m4a]/ba', ext: 'm4a', audio: true, extra: [] },
  'audio-mp3': { label: 'Audio saja (MP3)', format: 'ba/b', ext: 'mp3', audio: true, extra: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'] },
  // Highest resolution under the cap first; at equal resolution prefer H.264 (plays everywhere).
  ...Object.fromEntries([2160, 1440, 1080, 720, 480, 360].map(height => [`h${height}`, { label: `Maksimal ${height}p (MP4)`, format: capped(height), ext: 'mp4', audio: false, extra: ['-S', 'res,vcodec:h264,acodec:m4a'] }])),
};
export const youtubeOutputExtension = format => YOUTUBE_PRESETS[format]?.ext || 'mp4';
export const youtubeIsAudio = format => Boolean(YOUTUBE_PRESETS[format]?.audio);
export async function downloadYoutube(job, directory, signal, progress, speedLimit = 0) {
  await fs.mkdir(directory, { recursive:true });
  if (job.youtubeFormat && !/^[\w-]+(?:\+[\w-]+)?$/.test(job.youtubeFormat)) throw new Error('Format YouTube tidak valid.');
  const preset = YOUTUBE_PRESETS[job.youtubeFormat];
  const format = preset?.format || job.youtubeFormat || 'bv[ext=mp4][protocol=https]+ba[ext=m4a][protocol=https]/bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]';
  const ext = preset?.ext || 'mp4';
  const args = ['--match-filters','!is_live','--newline','--progress','--progress-template','download:ZIVAR:%(progress)j',
    '--print','before_dl:ZIVAR-SIZE:%(requested_formats.:.filesize)j:%(filesize,filesize_approx)s',
    '--no-simulate','--no-mtime','-f',format,'-o',path.join(directory,'video.%(ext)s'), ...(preset?.extra || [])];
  if (!preset?.audio) args.push('--merge-output-format','mp4','--remux-video','mp4');
  // Uploaded subtitles (Indonesian/English) are embedded into the MP4. Auto-translated
  // tracks are skipped: YouTube rate-limits them (HTTP 429), which would fail the video.
  if (job.youtubeSubtitles && !preset?.audio) args.push('--write-subs','--sub-langs','id,id-ID,en,en-US,en-GB','--embed-subs');
  if (speedLimit > 0) args.push('--limit-rate',String(speedLimit));
  const tracker = youtubeProgress(progress);
  await runExtractor([...args,'--',youtubeUrl(job.url)], { signal, timeout:24*60*60*1000, onLine:tracker });
  return path.join(directory,`video.${ext}`);
}
// ---- Playlists ----
export function youtubePlaylist(value) {
  try {
    const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname.toLowerCase())) return null;
    const list = u.searchParams.get('list');
    // "RD…" mixes are endless auto-generated radios, not real playlists.
    return list && /^[\w-]{10,64}$/.test(list) && !/^RD/.test(list) ? `https://www.youtube.com/playlist?list=${list}` : null;
  } catch { return null; }
}
export async function inspectPlaylist(value) {
  const url = youtubePlaylist(value); if (!url) throw new Error('URL playlist YouTube tidak valid. Gunakan tautan yang memiliki parameter list=.');
  const data = JSON.parse(await runExtractor(['--flat-playlist','--dump-single-json','--playlist-end','500','--',url], { timeout: 180000 }));
  const entries = (data.entries || []).filter(entry => /^[\w-]{11}$/.test(entry?.id || '')).map(entry => ({ id: entry.id, url: `https://www.youtube.com/watch?v=${entry.id}`, title: String(entry.title || entry.id).slice(0, 200), duration: Number(entry.duration) || null }));
  if (!entries.length) throw new Error('Playlist kosong atau tidak dapat dibaca.');
  return { url, title: data.title || 'Playlist YouTube', count: entries.length, entries, presets: Object.entries(YOUTUBE_PRESETS).map(([id, preset]) => ({ id, label: preset.label })) };
}
// yt-dlp downloads video and audio as separate files and reports progress per file.
// Combine them into one stable total so the size column does not jump or grow.
export function youtubeProgress(report) {
  const files = new Map(); let expected = null, estimated = true;
  return line => {
    if (line.startsWith('ZIVAR-SIZE:')) {
      const [, list, single] = /^ZIVAR-SIZE:(.*):([^:]*)$/.exec(line) || [];
      let sizes = null; try { sizes = JSON.parse(list); } catch {}
      if (Array.isArray(sizes) && sizes.length && sizes.every(size => Number(size) > 0)) { expected = sizes.reduce((sum, size) => sum + Number(size), 0); estimated = false; }
      else if (Number(single) > 0) expected = Number(single);
      return;
    }
    if (!line.startsWith('ZIVAR:')) return;
    let data; try { data = JSON.parse(line.slice(6)); } catch { return; }
    const name = data.filename || data.tmpfilename || ''; if (!name) return;
    const total = Number(data.total_bytes || data.total_bytes_estimate) || 0;
    const done = Number(data.downloaded_bytes) || (data.status === 'finished' ? total : 0);
    files.set(name, { done, total });
    const received = [...files.values()].reduce((sum, file) => sum + file.done, 0);
    const seen = [...files.values()].reduce((sum, file) => sum + file.total, 0);
    report({ received, total: Math.max(expected || seen, received) || null, estimated: !expected || estimated, speed: Number(data.speed) || 0 });
  };
}
