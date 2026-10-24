// Downloads the helper programs ZIVAR bundles (yt-dlp, a Node runtime for yt-dlp and FFmpeg)
// for the platform this script runs on, verifies their checksums and places them in vendor/.
//
//   node build/fetch-vendor.mjs [--force]
//
// FFmpeg comes from the `ffmpeg-static` npm package, which publishes builds for every
// supported platform. Install it first: npm install --no-save ffmpeg-static
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const { platform, arch } = process;
const win = platform === 'win32';
const exe = name => win ? `${name}.exe` : name;
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

async function download(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function place(from, directory, name) {
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, name);
  await fs.copyFile(from, target);
  if (!win) await fs.chmod(target, 0o755);
  console.log('  ->', path.relative(root, target));
}
const needed = (directory, name) => force || !existsSync(path.join(directory, name));

// ---- yt-dlp ----
async function fetchYtDlp() {
  const directory = path.join(root, 'vendor', 'yt-dlp');
  if (!needed(directory, exe('yt-dlp'))) return console.log('yt-dlp: already present');
  const asset = { win32: { x64: 'yt-dlp.exe' }, linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' }, darwin: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos' } }[platform]?.[arch];
  if (!asset) throw new Error(`yt-dlp: unsupported platform ${platform}-${arch}`);
  console.log(`yt-dlp: ${asset}`);
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const sums = (await download(`${base}/SHA2-256SUMS`)).toString('utf8');
  const expected = sums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(([, file]) => file === asset)?.[0];
  if (!expected) throw new Error(`yt-dlp: no checksum published for ${asset}`);
  const data = await download(`${base}/${asset}`);
  if (sha256(data) !== expected) throw new Error('yt-dlp: checksum mismatch');
  const temporary = path.join(os.tmpdir(), `zivar-${process.pid}-${asset}`);
  await fs.writeFile(temporary, data);
  await place(temporary, directory, exe('yt-dlp'));
  await fs.rm(temporary, { force: true });
  if (!existsSync(path.join(directory, 'SHA2-256SUMS'))) await fs.writeFile(path.join(directory, 'SHA2-256SUMS'), sums);
}

// ---- Node runtime (yt-dlp uses it to solve YouTube's JavaScript challenges) ----
async function fetchNode() {
  const directory = path.join(root, 'vendor', 'yt-dlp');
  if (!needed(directory, exe('node'))) return console.log('node: already present');
  const version = process.version;
  const nodeArch = { x64: 'x64', arm64: 'arm64' }[arch];
  if (!nodeArch) throw new Error(`node: unsupported architecture ${arch}`);
  const base = `https://nodejs.org/dist/${version}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
  const lookup = file => sums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(([, name]) => name === file)?.[0];
  console.log(`node: ${version} ${platform}-${nodeArch}`);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zivar-node-'));
  try {
    if (win) {
      const file = `win-${nodeArch}/node.exe`;
      const data = await download(`${base}/${file}`);
      if (sha256(data) !== lookup(file)) throw new Error('node: checksum mismatch');
      await fs.writeFile(path.join(temporary, 'node.exe'), data);
    } else {
      const folder = `node-${version}-${platform}-${nodeArch}`;
      const archive = `${folder}.tar.${platform === 'darwin' ? 'gz' : 'xz'}`;
      const data = await download(`${base}/${archive}`);
      if (sha256(data) !== lookup(archive)) throw new Error('node: checksum mismatch');
      await fs.writeFile(path.join(temporary, archive), data);
      execFileSync('tar', ['-xf', archive, '--strip-components=2', `${folder}/bin/node`], { cwd: temporary, stdio: 'inherit' });
    }
    await place(path.join(temporary, exe('node')), directory, exe('node'));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

// ---- FFmpeg ----
async function fetchFfmpeg() {
  const directory = path.join(root, 'vendor', 'ffmpeg');
  if (!needed(directory, exe('ffmpeg'))) return console.log('ffmpeg: already present');
  let source;
  try { source = createRequire(import.meta.url)('ffmpeg-static'); }
  catch { throw new Error('ffmpeg: install the "ffmpeg-static" package first (npm install --no-save ffmpeg-static).'); }
  if (!source || !existsSync(source)) throw new Error('ffmpeg: ffmpeg-static has no binary for this platform.');
  console.log('ffmpeg: from ffmpeg-static');
  await place(source, directory, exe('ffmpeg'));
  if (!existsSync(path.join(directory, `${exe('ffmpeg')}.README`))) await fs.writeFile(path.join(directory, `${exe('ffmpeg')}.README`), 'FFmpeg is licensed under the GPL. Source and build details: https://ffmpeg.org/ and https://github.com/eugeneware/ffmpeg-static\n');
}

for (const step of [fetchYtDlp, fetchNode, fetchFfmpeg]) await step();
console.log('Done.');
