import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'portable-'));
const state = path.join(temporary, 'state'); await fs.mkdir(state);
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
const environment = { ...process.env, ZIVAR_PORT: '0', ZIVAR_DESKTOP_DATA_DIR: state, ZIVAR_DESKTOP_DOWNLOAD_DIR: path.join(temporary, 'downloads'), ZIVAR_DESKTOP_TEST_MODE: '1' };
// Keep ELECTRON_RUN_AS_NODE=1 deliberately: the packaged fuse must ignore it.
environment.ELECTRON_RUN_AS_NODE = '1';
const child = spawn(path.join(project, 'dist', `ZIVAR-${version}-Portable.exe`), [`--remote-debugging-port=${debugPort}`], { cwd: temporary, env: environment, windowsHide: true, stdio: 'pipe' });
let browser, logs = '';
child.stdout.on('data', bytes => logs += bytes); child.stderr.on('data', bytes => logs += bytes);
try {
  const started = Date.now();
  for (;;) {
    try { const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    if (child.exitCode !== null) throw new Error(`Portable exited early (${child.exitCode}): ${logs.slice(-2000)}`);
    if (Date.now() - started > 60000) throw new Error(`Portable did not start: ${logs.slice(-2000)}`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  const page = context.pages().find(page => page.url().startsWith('http://127.0.0.1:')) || await context.waitForEvent('page');
  await page.locator('#edition-label').filter({ hasText: 'Pengelola unduhan desktop' }).waitFor();
  const info = await page.evaluate(() => window.zivarDesktop.getInfo());
  assert.equal(info.version, version); assert.equal(info.attached, false);
  assert.equal(info.extensionDirectory, path.join(state, 'browser-extension'));
  await fs.access(path.join(info.extensionDirectory, 'manifest.json'));
  await page.locator('#setup-dialog[open]').waitFor();
  await page.locator('#setup-finish').click();
  await page.screenshot({ path: path.join(project, 'artifacts', 'portable-app.png'), fullPage: true });
  await page.locator('#menu-tasks').click(); await page.locator('#quit-app').click();
  await new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('Portable did not shut down.')), 20000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await fs.access(path.join(info.extensionDirectory, 'manifest.json'));
  console.log('PASS: single portable EXE extracts and launches without Node.js, packaged fuse ignores RUN_AS_NODE, desktop bridge loads, extension path survives exit, clean shutdown.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  if (path.dirname(path.resolve(temporary)) !== path.resolve(root)) throw new Error('Unsafe portable test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
