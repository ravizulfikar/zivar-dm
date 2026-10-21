// Builds the Firefox version of the companion extension into dist/firefox-extension
// (and a .zip for submission to addons.mozilla.org). Same code; only the manifest differs:
// Firefox runs the background as an event page and needs a stable add-on ID.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(project, 'dist', 'firefox-extension');
await fs.rm(output, { recursive: true, force: true });
await fs.cp(path.join(project, 'extension'), output, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ['background.js'] };
manifest.browser_specific_settings = { gecko: { id: 'companion@zivar.local', strict_min_version: '128.0' } };
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const zip = path.join(project, 'dist', `zivar-companion-firefox-${manifest.version}.zip`);
await fs.rm(zip, { force: true });
// Windows' built-in tar can write zip archives.
const result = spawnSync('tar.exe', ['-a', '-c', '-f', zip, '-C', output, '.'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
console.log(`Firefox extension: ${output}\nPackage: ${zip}`);
