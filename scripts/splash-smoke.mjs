// The start-up splash in the real Electron app: it appears first, shows the name, version and website, plays
// its animation, then makes way for the main window. Tests normally run without it (test mode), so this
// one asks for it with ZIVAR_SPLASH=1.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(path.join(project, 'artifacts'), { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'splash-'));
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const cleanEnvironment = { ...process.env };
delete cleanEnvironment.ELECTRON_RUN_AS_NODE;

async function launch(name, extra = {}, args = []) {
  const state = path.join(temporary, name, 'state');
  await fs.mkdir(state, { recursive: true });
  return electron.launch({
    executablePath: process.env.ZIVAR_DESKTOP_EXE || path.join(project, 'node_modules/electron/dist/electron.exe'),
    args: process.env.ZIVAR_DESKTOP_EXE ? args : [project, ...args], cwd: project, timeout: 60000,
    env: { ...cleanEnvironment, ZIVAR_PORT: '0', ZIVAR_DESKTOP_DATA_DIR: state, ZIVAR_DESKTOP_DOWNLOAD_DIR: path.join(temporary, name, 'downloads'), ZIVAR_DESKTOP_TEST_MODE: '1', ...extra },
  });
}
const titles = async app => Promise.all(app.windows().map(page => page.title().catch(() => '')));
const until = async (predicate, ms = 20000, what = 'condition') => { const start = Date.now(); for (;;) { const value = await predicate(); if (value) return value; if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`); await new Promise(resolve => setTimeout(resolve, 100)); } };
const splashPage = async app => { for (const page of app.windows()) if ((await page.title().catch(() => '')).includes('starting')) return page; return null; };

let desktop;
try {
  // 1. Asked for: the splash is the first window, with everything it should say.
  desktop = await launch('shown', { ZIVAR_SPLASH: '1', ZIVAR_SPLASH_MIN_MS: '5000' });
  const splash = await until(() => splashPage(desktop), 20000, 'the splash window');
  await splash.waitForLoadState();
  const text = await splash.locator('body').innerText();
  for (const expected of ['ZIVAR Download Manager', 'Fast, local and private downloads', `v${version}`, 'zivar.my.id', 'Starting']) assert.ok(text.includes(expected), `the splash shows "${expected}": ${JSON.stringify(text)}`);
  // The Z draws itself (its stroke is fully drawn once the animation has run) and the packet keeps moving.
  await splash.waitForFunction(() => getComputedStyle(document.querySelector('.z')).strokeDashoffset === '0px' || Number.parseFloat(getComputedStyle(document.querySelector('.z')).strokeDashoffset) === 0, null, { timeout: 8000 });
  assert.equal(await splash.evaluate(() => getComputedStyle(document.querySelector('.stem')).opacity), '1', 'the arrowhead is drawn');
  await splash.screenshot({ path: path.join(project, 'artifacts', 'splash.png') });
  assert.equal(await splash.evaluate(() => document.querySelectorAll('script').length), 0, 'no script runs in the splash');
  const box = await desktop.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('starting')); return win && { frame: !win.isResizable(), onTop: win.isAlwaysOnTop(), visible: win.isVisible() }; });
  assert.deepEqual(box, { frame: true, onTop: true, visible: true }, 'a fixed-size window that stays on top while it is shown');
  // The splash stays for its minimum time, then fades out and leaves only the main window.
  await until(async () => !(await splashPage(desktop)), 20000, 'the splash to close');
  const remaining = await titles(desktop);
  assert.ok(remaining.some(title => title === 'ZIVAR Download Manager'), `the main window is there: ${remaining}`);
  assert.equal(remaining.filter(title => title.includes('starting')).length, 0);
  await desktop.close(); desktop = null;

  // 2. Tests and automation start without it, so the first window is the real one.
  desktop = await launch('quiet');
  const first = await desktop.firstWindow();
  assert.ok(!(await first.title()).includes('starting'), 'no splash in test mode');
  assert.equal((await titles(desktop)).filter(title => title.includes('starting')).length, 0);
  await desktop.close(); desktop = null;

  // 3. Starting into the tray (start at login) never shows a window, even when asked for the splash.
  desktop = await launch('hidden', { ZIVAR_SPLASH: '1' }, ['--hidden']);
  await until(async () => (await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) >= 1, 20000, 'the main window to exist');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal((await titles(desktop)).filter(title => title.includes('starting')).length, 0, 'no splash when starting hidden');
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length), 0, 'nothing is visible');
  await desktop.close(); desktop = null;

  // 4. Turned off in Settings: the saved setting is honoured before the engine even starts.
  await fs.mkdir(path.join(temporary, 'off', 'state'), { recursive: true });
  await fs.writeFile(path.join(temporary, 'off', 'state', 'settings.json'), JSON.stringify({ splash: false }));
  desktop = await launch('off', { ZIVAR_DESKTOP_TEST_MODE: '' });
  await until(async () => (await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) >= 1, 20000, 'a window');
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal((await titles(desktop)).filter(title => title.includes('starting')).length, 0, 'no splash when it is turned off');
  console.log('PASS: splash shows name, tagline, version and website, draws its animation, stays on top for its minimum time, then closes before the main window; absent in test mode, when starting hidden and when turned off in Settings.');
} finally {
  await desktop?.close().catch(() => {});
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(root)) throw new Error('Unsafe splash test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
}
