import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeName = value => String(value || 'video').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 150) || 'video';
const valid = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };

export function ffmpegPath() {
  if (process.env.ZIVAR_FFMPEG_PATH && path.isAbsolute(process.env.ZIVAR_FFMPEG_PATH)) return process.env.ZIVAR_FFMPEG_PATH;
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : null;
  return packaged || path.join(project, 'vendor', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

function formatTime(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)/.exec(value || '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

async function run(command, args, { signal, onProgress }) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', duration = null;
  const abort = () => child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-12_000);
    const durationMatch = /Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/.exec(chunk); if (durationMatch) duration = formatTime(durationMatch[1]);
    const timeMatch = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(chunk); if (timeMatch) onProgress?.(formatTime(timeMatch[1]), duration);
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, closeSignal) => resolve({ exitCode, closeSignal })); });
  signal.removeEventListener('abort', abort);
  if (signal.aborted) throw signal.reason || new Error('Pemrosesan media dihentikan.');
  if (code.exitCode !== 0 && /403 Forbidden/i.test(stderr)) throw new Error('Server video menolak akses (HTTP 403). Situs ini memblokir unduhan dari luar browser, atau tautan sudah kedaluwarsa.');
  if (code.exitCode !== 0) throw new Error(stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || `FFmpeg berhenti dengan kode ${code.exitCode}.`);
}

export async function muxMedia({ inputUrl, audioUrl, outputPath, headers = {}, audioHeaders = {}, signal, onProgress }) {
  if (!valid(inputUrl)) throw new Error('URL playlist video tidak valid.');
  if (audioUrl && !valid(audioUrl)) throw new Error('URL playlist audio tidak valid.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const makeHeaderArgs = values => {
    const headerLines = [];
    const referer = values.referer || values.referrer;
    if (referer && valid(referer)) headerLines.push(`Referer: ${referer}`);
    for (const [key, value] of Object.entries(values)) {
      const name = String(key).toLowerCase();
      if (!['cookie', 'user-agent', 'authorization', 'origin'].includes(name) || typeof value !== 'string' || !value || /[\r\n]/.test(value)) continue;
      headerLines.push(`${name.replace(/^./, char => char.toUpperCase())}: ${value}`);
    }
    return headerLines.length ? ['-headers', `${headerLines.join('\r\n')}\r\n`] : [];
  };
  const headerArgs = makeHeaderArgs(headers), audioHeaderArgs = makeHeaderArgs(audioHeaders);
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', ...headerArgs, '-i', inputUrl];
  if (audioUrl) args.push(...audioHeaderArgs, '-i', audioUrl);
  args.push('-map', '0:v:0?', ...(audioUrl ? ['-map', '1:a:0?'] : ['-map', '0:a:0?']), '-c', 'copy', '-movflags', '+faststart', outputPath);
  await run(ffmpegPath(), args, { signal, onProgress });
}

// Join video + audio files that are already on disk (browser-assisted downloads).
export async function muxFiles({ videoPath, audioPath = null, outputPath, signal }) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-i', videoPath];
  if (audioPath) args.push('-i', audioPath);
  args.push('-map', '0:v:0?', ...(audioPath ? ['-map', '1:a:0?'] : ['-map', '0:a:0?']), '-c', 'copy', '-movflags', '+faststart', outputPath);
  await run(ffmpegPath(), args, { signal });
}

export { safeName };
