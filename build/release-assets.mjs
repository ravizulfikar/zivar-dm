// Prepares the files published with a GitHub release.
//
//   node build/release-assets.mjs <version> <artifacts-dir> <github-repo>
//
// <artifacts-dir> holds one sub-folder per build named release-<os>-<arch>
// (for example release-linux-x64). The script writes, into <artifacts-dir>:
//   SHA256SUMS.txt     checksum of every installer
//   latest.json        update feed read by the app (see "Pembaruan" in README.md)
//   release-notes.md   the matching section of CHANGELOG.md
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [version, directory, repository] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !directory || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
  console.error('Usage: node build/release-assets.mjs <version> <artifacts-dir> <owner/repo>');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Each installer kind the app can update itself with. The key suffix tells the app which one to pick
// for how it was installed (see desktop/updater.mjs): none = default, -portable, -deb, -rpm.
const variantOf = (os, name) => ({
  win: name === `ZIVAR-Setup-${version}.exe` ? '' : name === `ZIVAR-${version}-Portable.exe` ? '-portable' : null,
  mac: name.endsWith('.dmg') ? '' : null,
  linux: name.endsWith('.AppImage') ? '' : name.endsWith('.deb') ? '-deb' : name.endsWith('.rpm') ? '-rpm' : null,
}[os] ?? null);
const isPublished = name => /\.(exe|dmg|zip|AppImage|deb|rpm|gz)$/.test(name) && !name.endsWith('.blockmap');

const sums = [], platforms = {};
for (const folder of (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('release-'))) {
  const [, os, arch] = folder.name.split('-');
  for (const name of (await fs.readdir(path.join(directory, folder.name))).sort()) {
    if (!isPublished(name)) continue;
    const file = path.join(directory, folder.name, name);
    const sha256 = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    sums.push(`${sha256}  ${name}`);
    const variant = variantOf(os, name);
    if (variant !== null) {
      const key = `${{ win: 'win32', mac: 'darwin', linux: 'linux' }[os]}-${arch}${variant}`;
      platforms[key] = { url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}`, sha256 };
    }
  }
}
if (!sums.length) { console.error('No release files found in', directory); process.exit(1); }

// Release notes: the "## [version]" section of CHANGELOG.md.
const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) { console.error(`CHANGELOG.md has no section for ${version}.`); process.exit(1); }
const next = changelog.indexOf('\n## [', start + 1);
const notes = changelog.slice(start, next < 0 ? undefined : next).split('\n').slice(1).join('\n').trim();

await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify({ version, notes, platforms }, null, 2) + '\n');
await fs.writeFile(path.join(directory, 'release-notes.md'), notes + '\n');
console.log(`${sums.length} files, ${Object.keys(platforms).length} update targets: ${Object.keys(platforms).join(', ')}`);
