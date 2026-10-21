import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ytDlpDirectory = path.join(project, 'vendor', 'yt-dlp');
const ffmpegDirectory = path.join(project, 'vendor', 'ffmpeg');
const binaries = {
  ytDlp: {
    target: path.join(ytDlpDirectory, 'yt-dlp.exe'),
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
    sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
  },
  node: {
    target: path.join(ytDlpDirectory, 'node.exe'),
    url: 'https://nodejs.org/dist/v24.22.1/win-x64/node.exe',
    sha256: 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5',
  },
  ffmpeg: {
    target: path.join(ffmpegDirectory, 'ffmpeg.exe'),
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    archiveUrl: 'https://github.com/GyanD/codexffmpeg/releases/download/6.1.1/ffmpeg-6.1.1-essentials_build.zip',
    archiveSha256: '742e32fc9f92681f9f254b925e1b613fdd8074ba40749d4879aefdb009b94cc5',
  },
};

async function sha256(file) {
  const hash = createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
  } finally { await handle.close(); }
  return hash.digest('hex');
}
async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Download dependency gagal (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), (await import('node:fs')).createWriteStream(destination));
}
async function verified(file, expected) {
  return existsSync(file) && (await sha256(file)).toLowerCase() === expected;
}
async function ensureBinary({ target, url, sha256: expected }) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await verified(target, expected)) return false;
  const temporary = `${target}.download`;
  await fs.rm(temporary, { force: true });
  try {
    console.log(`Mengunduh ${path.basename(target)}...`);
    await download(url, temporary);
    if (!(await verified(temporary, expected))) throw new Error(`SHA-256 ${path.basename(target)} tidak cocok.`);
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
    return true;
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
function powershellQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(error.trim() || `${command} berhenti dengan kode ${code}`)));
  });
}
async function findFile(directory, filename) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return candidate;
    if (entry.isDirectory()) { const found = await findFile(candidate, filename); if (found) return found; }
  }
  return null;
}
async function ensureFfmpeg() {
  if (await verified(binaries.ffmpeg.target, binaries.ffmpeg.sha256)) return false;
  if (process.platform !== 'win32') throw new Error('FFmpeg bawaan hanya dapat disiapkan untuk build Windows.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-ffmpeg-'));
  const archive = path.join(temporary, 'ffmpeg.zip');
  const extract = path.join(temporary, 'extract');
  try {
    console.log('Mengunduh ffmpeg.exe...');
    await download(binaries.ffmpeg.archiveUrl, archive);
    if (!(await verified(archive, binaries.ffmpeg.archiveSha256))) throw new Error('SHA-256 arsip FFmpeg tidak cocok.');
    await fs.mkdir(extract, { recursive: true });
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${powershellQuote(archive)} -DestinationPath ${powershellQuote(extract)} -Force`]);
    const source = await findFile(extract, 'ffmpeg.exe');
    if (!source) throw new Error('ffmpeg.exe tidak ditemukan di arsip resmi.');
    await fs.mkdir(path.dirname(binaries.ffmpeg.target), { recursive: true });
    await fs.copyFile(source, binaries.ffmpeg.target);
    if (!(await verified(binaries.ffmpeg.target, binaries.ffmpeg.sha256))) throw new Error('SHA-256 ffmpeg.exe tidak cocok.');
    return true;
  } finally { await fs.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
}

if (process.platform !== 'win32') throw new Error('ensure-vendor-binaries.mjs hanya diperlukan untuk build Windows.');
const downloaded = [];
if (await ensureBinary(binaries.ytDlp)) downloaded.push('yt-dlp.exe');
if (await ensureBinary(binaries.node)) downloaded.push('node.exe');
if (await ensureFfmpeg()) downloaded.push('ffmpeg.exe');
console.log(downloaded.length ? `Dependency vendor siap: ${downloaded.join(', ')}` : 'Dependency vendor sudah tersedia dan tervalidasi.');
