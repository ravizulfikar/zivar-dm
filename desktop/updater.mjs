// Pure helpers for the in-app updater (kept free of Electron so they can be unit tested).
import { existsSync } from 'node:fs';
import path from 'node:path';

export const isNewer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// How this copy of ZIVAR was installed decides which file to download and how to apply it.
//   setup, portable (Windows) · dmg (macOS) · appimage, deb, rpm, archive (Linux)
export function installKind({ platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'setup';
  if (platform === 'darwin') return 'dmg';
  if (env.APPIMAGE) return 'appimage';
  const installed = execPath.startsWith('/opt/') || execPath.startsWith('/usr/');
  if (installed && exists('/var/lib/dpkg/status')) return 'deb';
  if (installed && (exists('/usr/bin/rpm') || exists('/bin/rpm'))) return 'rpm';
  return 'archive';
}

// Feed format: {"version","notes","platforms":{"win32-x64":{url,sha256},"win32-x64-portable":{…},"linux-x64-deb":{…}}}
// or the older single-installer form {"version","url","sha256"}.
export function pickAsset(info, { platform = process.platform, arch = process.arch, kind = installKind() } = {}) {
  if (!info.platforms) return info.url ? { url: info.url, sha256: info.sha256 } : null;
  const variant = { portable: '-portable', deb: '-deb', rpm: '-rpm' }[kind] || '';
  return info.platforms[`${platform}-${arch}${variant}`] || info.platforms[`${platform}-${arch}`] || null;
}

// Which message the interface shows for a finished download.
export const installGroup = kind => ({ portable: 'portable', dmg: 'dmg', deb: 'package', rpm: 'package', archive: 'package' }[kind] || 'setup');

export function safeFilename(url, version, kind) {
  let name = '';
  try { name = decodeURIComponent(path.posix.basename(new URL(url).pathname)); } catch {}
  name = name.replace(/[^\w.\-+() ]/g, '_').slice(0, 120);
  return /\.[A-Za-z0-9]{2,8}$/.test(name) ? name : `ZIVAR-${version}-${kind}${kind === 'setup' || kind === 'portable' ? '.exe' : ''}`;
}
