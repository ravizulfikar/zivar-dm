import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, clipboard, shell, dialog, Notification } from 'electron';
import fs from 'node:fs/promises';
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../app/server.mjs';
import { normalizeProxy } from '../app/manager.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(directory);
app.setName('ZIVAR Download Manager');
if (process.env.ZIVAR_DESKTOP_DATA_DIR) app.setPath('userData', path.resolve(process.env.ZIVAR_DESKTOP_DATA_DIR));
const dataDirectory = process.env.ZIVAR_DESKTOP_DATA_DIR || app.getPath('userData');
const downloadDirectory = process.env.ZIVAR_DESKTOP_DOWNLOAD_DIR || path.join(app.getPath('downloads'), 'ZIVAR');
const port = Number(process.env.ZIVAR_PORT || 18765);
let window, tray, service, quitting = false, shutdownStarted = false, shownTrayNotice = false, setupPending = true, clipboardTimer = null, lastClipboard = '';
const bundledExtensionDirectory = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(project, 'extension');
const extensionDirectory = path.join(dataDirectory, 'browser-extension');
const legacyCandidates = [
  path.join(project, '.data'),
  ...(process.env.PORTABLE_EXECUTABLE_DIR ? [path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.data'), path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_DIR), '.data')] : []),
];

// ---- Proxy ----
// Node's built-in fetch, yt-dlp and FFmpeg all read the standard proxy variables, but
// Node reads them only at process start. When the saved proxy differs from the one
// this process started with, restart once with the right environment.
function savedProxy() {
  try { return normalizeProxy(JSON.parse(readFileSync(path.join(dataDirectory, 'settings.json'), 'utf8')).proxy); } catch { return ''; }
}
function proxyEnvironment(proxy) {
  const env = { ...process.env };
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NODE_USE_ENV_PROXY', 'ZIVAR_PROXY']) delete env[name];
  if (proxy) Object.assign(env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NODE_USE_ENV_PROXY: '1', NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1', ZIVAR_PROXY: proxy });
  return env;
}
const activeProxy = () => process.env.ZIVAR_PROXY || '';
function relaunchWithProxy(proxy) {
  const env = proxyEnvironment(proxy);
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
  process.env.ZIVAR_PROXY_RELAUNCH = '1';
  // A portable build runs from a temporary folder; restart the portable EXE itself.
  app.relaunch(process.env.PORTABLE_EXECUTABLE_FILE ? { execPath: process.env.PORTABLE_EXECUTABLE_FILE, args: process.argv.slice(1) } : undefined);
}
if (savedProxy() !== activeProxy() && process.env.ZIVAR_PROXY_RELAUNCH !== '1' && process.env.ZIVAR_DESKTOP_TEST_MODE !== '1') {
  relaunchWithProxy(savedProxy()); app.exit(0);
}
delete process.env.ZIVAR_PROXY_RELAUNCH;

// Test hook: record notifications and power actions instead of performing them.
const testLog = process.env.ZIVAR_TEST_POWER_LOG || '';
const record = line => { if (testLog) try { appendFileSync(testLog, line + '\n'); } catch {} };

async function log(error) {
  try { await fs.mkdir(dataDirectory, { recursive: true }); await fs.appendFile(path.join(dataDirectory, 'desktop.log'), `${new Date().toISOString()} ${error.stack || error}\n`); } catch {}
}

// Only attach to a running engine from the same major.minor release as this app.
const sameRelease = version => typeof version === 'string' && version.split('.').slice(0, 2).join('.') === app.getVersion().split('.').slice(0, 2).join('.');

async function bootService() {
  // Reuse an authenticated local ZIVAR engine if the web edition is already running.
  // Do not stop someone else's process or navigate to an arbitrary occupied port.
  if (port) for (const candidate of [dataDirectory, ...legacyCandidates]) {
    try {
      const token = (await fs.readFile(path.join(candidate, 'token'), 'utf8')).trim();
      if (!/^[a-f0-9]{48}$/.test(token)) continue;
      const origin = `http://127.0.0.1:${port}`;
      const response = await fetch(origin + '/api/state', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1200), redirect: 'error' });
      const state = await response.json();
      if (response.ok && Array.isArray(state.jobs) && sameRelease(state.version)) return { origin, token, attached: true, downloadDirectory: state.downloadDirectory, manager: null, close: async () => {} };
    } catch {}
  }
  // On the first desktop launch, preserve the old local queue and pairing token.
  // Copy only into a fresh desktop data directory; never overwrite desktop state.
  if (!process.env.ZIVAR_DESKTOP_DATA_DIR) {
    const initialized = await fs.access(path.join(dataDirectory, 'token')).then(() => true, () => false);
    if (!initialized) for (const candidate of legacyCandidates) {
      if (path.resolve(candidate) === path.resolve(dataDirectory)) continue;
      const exists = await fs.access(path.join(candidate, 'token')).then(() => true, () => false);
      if (!exists) continue;
      await fs.mkdir(dataDirectory, { recursive: true });
      for (const name of ['jobs.json', 'parts', 'token']) {
        try { await fs.cp(path.join(candidate, name), path.join(dataDirectory, name), { recursive: name === 'parts', force: false, errorOnExist: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      break;
    }
  }
  return { ...await startServer({ port, dataDirectory, downloadDirectory, onFocus: showWindow, extractorUpdates: process.env.ZIVAR_DESKTOP_TEST_MODE !== '1' }), attached: false, downloadDirectory };
}

function showWindow() { if (!window || window.isDestroyed() || process.env.ZIVAR_DESKTOP_TEST_MODE === '1') return; window.show(); if (window.isMinimized()) window.restore(); window.focus(); }
function startClipboardMonitor() {
  clearInterval(clipboardTimer);
  if (!service?.manager) return;
  const check = async () => {
    try {
      // Newer Electron versions may return a Promise here; await handles both.
      const text = String(await clipboard.readText() || '').trim();
      if (!text || text === lastClipboard) return;
      lastClipboard = text;
      if (!/^https?:\/\//i.test(text) || !service.manager.settings().clipboardMonitor) return;
      const duplicate = service.manager.jobs.find(job => job.url === text && !['cancelled', 'completed'].includes(job.status));
      if (!duplicate) await service.manager.add({ url: text });
    } catch (error) { await log(error); }
  };
  check(); clipboardTimer = setInterval(check, 1200); clipboardTimer.unref?.();
}
// ---- Notifications and "after all downloads finish" ----
const BUSY = ['queued', 'downloading', 'assembling', 'pausing', 'cancelling'];
let lastStatus = new Map(), hadWork = false, afterAllRunning = false;
function notify(title, body) {
  record(`notify:${title}:${body}`);
  if (process.env.ZIVAR_DESKTOP_TEST_MODE === '1' || !Notification.isSupported()) return;
  const note = new Notification({ title, body, icon: path.join(directory, 'assets', 'app.png') });
  note.on('click', showWindow); note.show();
}
function watchJobs() {
  const manager = service?.manager; if (!manager) return;
  for (const job of manager.jobs) lastStatus.set(job.id, job.status);
  manager.on('change', job => {
    const previous = lastStatus.get(job.id); lastStatus.set(job.id, job.status);
    if (BUSY.includes(job.status)) hadWork = true;
    if (previous === job.status) return;
    const settings = manager.settings();
    if (settings.notifications && job.status === 'completed' && previous) notify('Unduhan selesai', job.filename);
    if (settings.notifications && job.status === 'error' && previous) notify('Unduhan gagal', `${job.filename}: ${job.error || 'Klik Lanjut untuk mencoba lagi.'}`);
    // Wait a moment so a queue that is just switching jobs is not mistaken for "done".
    setTimeout(checkAllDone, 1500);
  });
}
async function checkAllDone() {
  const manager = service?.manager; if (!manager || afterAllRunning || !hadWork) return;
  if (manager.jobs.some(job => BUSY.includes(job.status))) return;
  hadWork = false;
  const action = manager.settings().afterAll;
  if (action === 'none') return;
  // One-shot, like IDM: the choice applies to the current batch only.
  await manager.updateSettings({ afterAll: 'none' }).catch(log);
  afterAllRunning = true;
  try { await runAfterAll(action); } catch (error) { await log(error); } finally { afterAllRunning = false; }
}
// Power commands per platform. Windows schedules the shutdown up front so the OS shows
// its own countdown; macOS and Linux run the command once the countdown ends.
const isWindows = process.platform === 'win32';
const run = (command, args) => spawn(command, args, { windowsHide: true, stdio: 'ignore' }).on('error', log);
const powerCommands = {
  win32: { shutdown: ['shutdown.exe', ['/s', '/t', '0']], sleep: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)']] },
  darwin: { shutdown: ['osascript', ['-e', 'tell application "System Events" to shut down']], sleep: ['pmset', ['sleepnow']] },
  linux: { shutdown: ['systemctl', ['poweroff']], sleep: ['systemctl', ['suspend']] },
}[process.platform] || {};
async function runAfterAll(action) {
  const labels = { quit: 'menutup ZIVAR', sleep: 'membuat komputer tidur (sleep)', shutdown: 'mematikan komputer' };
  record(`after-all:${action}`);
  if (action === 'quit') { quitting = true; app.quit(); return; }
  if (testLog) return;
  const command = powerCommands[action];
  if (!command) { notify('Aksi tidak didukung', `Sistem ini tidak mendukung aksi "${labels[action]}".`); return; }
  // 60-second countdown with a Cancel button.
  const controller = new AbortController(); let seconds = 60;
  if (isWindows && action === 'shutdown') run('shutdown.exe', ['/s', '/t', '60', '/c', 'ZIVAR: semua unduhan selesai. Komputer akan dimatikan.']);
  const timer = setInterval(() => { seconds--; if (seconds <= 0) controller.abort(); }, 1000);
  showWindow();
  const answer = await dialog.showMessageBox(window, { type: 'warning', title: 'Semua unduhan selesai', message: `ZIVAR akan ${labels[action]} dalam 60 detik.`, detail: 'Klik Batalkan untuk membatalkan.', buttons: ['Batalkan', 'Lakukan sekarang'], defaultId: 1, cancelId: 0, noLink: true, signal: controller.signal });
  clearInterval(timer);
  const cancelled = !controller.signal.aborted && answer.response === 0;
  if (cancelled) { if (isWindows && action === 'shutdown') run('shutdown.exe', ['/a']); return; }
  if (isWindows && action === 'shutdown' && answer.response === 1) spawn('shutdown.exe', ['/a'], { windowsHide: true, stdio: 'ignore' }).on('exit', () => run(...command));
  else if (!(isWindows && action === 'shutdown')) run(...command);
}
// ---- App updates ----
// The feed is a small JSON file you publish: {"version":"0.15.0","url":"https://…/ZIVAR-Setup-0.15.0.exe","sha256":"…","notes":"…"}.
// Set it in package.json ("zivar": {"updateFeed": "https://…/latest.json"}) or ZIVAR_UPDATE_FEED.
// The installer is downloaded through ZIVAR's own queue and checked against the SHA-256; it is never run silently.
const appPackage = (() => { try { return JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')); } catch { return {}; } })();
const updateFeed = process.env.ZIVAR_UPDATE_FEED || appPackage.zivar?.updateFeed || '';
const isNewer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdate() {
  if (!updateFeed) return { configured: false, current: app.getVersion() };
  let response;
  try { response = await fetch(updateFeed, { cache: 'no-store', signal: AbortSignal.timeout(15000) }); } catch { throw new Error('Server pembaruan tidak dapat dihubungi.'); }
  if (!response.ok) throw new Error(`Server pembaruan membalas HTTP ${response.status}.`);
  const info = await response.json().catch(() => ({}));
  if (!/^\d+\.\d+\.\d+$/.test(info.version || '')) throw new Error('Info pembaruan tidak valid.');
  // A feed may list one installer per platform: {"platforms":{"win32-x64":{"url":"…","sha256":"…"}}}.
  const platform = info.platforms?.[`${process.platform}-${process.arch}`];
  if (info.platforms && !platform) return { configured: true, current: app.getVersion(), version: info.version, available: false, notes: '', unsupported: true };
  if (platform) Object.assign(info, { url: platform.url, sha256: platform.sha256 });
  const url = new URL(info.url || '', updateFeed);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Alamat installer pembaruan harus memakai HTTPS.');
  if (!/^[a-f0-9]{64}$/i.test(info.sha256 || '')) throw new Error('Info pembaruan tidak menyertakan checksum SHA-256.');
  return { configured: true, current: app.getVersion(), version: info.version, available: isNewer(info.version, app.getVersion()), notes: String(info.notes || '').slice(0, 2000), url: url.href, sha256: info.sha256.toLowerCase() };
}
async function downloadUpdate() {
  const info = await checkUpdate();
  if (!info.available) throw new Error('ZIVAR sudah versi terbaru.');
  if (!service.manager) throw new Error('Unduh pembaruan dari mesin ZIVAR desktop.');
  const extension = path.extname(new URL(info.url).pathname).toLowerCase();
  const name = /^\.(exe|dmg|deb|rpm|appimage|zip|gz)$/.test(extension) ? `ZIVAR-Setup-${info.version}${extension}` : `ZIVAR-Setup-${info.version}${isWindows ? '.exe' : ''}`;
  return service.manager.add({ url: info.url, filename: name, expectedSha256: info.sha256, category: 'program' });
}
async function backgroundUpdateCheck() {
  if (!updateFeed || process.env.ZIVAR_DESKTOP_TEST_MODE === '1') return;
  const marker = path.join(dataDirectory, 'update-check.json');
  try { const last = JSON.parse(await fs.readFile(marker, 'utf8')); if (Date.now() - Date.parse(last.checkedAt) < 3 * 86400_000) return; } catch {}
  try {
    const info = await checkUpdate();
    await fs.writeFile(marker, JSON.stringify({ checkedAt: new Date().toISOString(), version: info.version }));
    if (info.available) notify('Pembaruan ZIVAR tersedia', `Versi ${info.version} siap diunduh. Buka Bantuan → Periksa pembaruan.`);
  } catch (error) { await log(error); }
}

// ---- Start at login ----
// Windows and macOS use Electron's login items. Linux has no such API, so an XDG autostart
// entry is written instead (an AppImage starts itself through $APPIMAGE).
const startupTarget = () => process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart', 'zivar-download-manager.desktop');
function getAutoStart() {
  if (process.platform === 'linux') { try { readFileSync(autostartFile()); return true; } catch { return false; } }
  return Boolean(app.getLoginItemSettings({ path: startupTarget(), args: ['--hidden'] }).openAtLogin);
}
function setAutoStart(enabled) {
  if (process.platform === 'linux') {
    const quote = value => `"${String(value).replace(/(["`$\\])/g, '\\$1')}"`;
    const entry = ['[Desktop Entry]', 'Type=Application', 'Name=ZIVAR Download Manager', `Exec=${quote(startupTarget())} --hidden`, 'Icon=zivar-download-manager', 'X-GNOME-Autostart-enabled=true', 'Terminal=false', ''].join('\n');
    try {
      if (enabled) { mkdirSync(path.dirname(autostartFile()), { recursive: true }); writeFileSync(autostartFile(), entry); }
      else rmSync(autostartFile(), { force: true });
    } catch (error) { log(error); }
    return getAutoStart();
  }
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: startupTarget(), args: ['--hidden'] }); return getAutoStart();
}
const startHidden = process.argv.includes('--hidden');

function trusted(event) { return event.sender === window?.webContents && event.senderFrame?.url === service?.origin + '/'; }
function installBridge() {
  ipcMain.handle('zivar:info', event => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    return { isDesktop: true, attached: service.attached, extensionDirectory, downloadDirectory: service.downloadDirectory, version: app.getVersion(), showSetup: setupPending };
  });
  ipcMain.handle('zivar:copy', (event, text) => {
    if (!trusted(event) || typeof text !== 'string' || text.length > 4096) throw new Error('Permintaan clipboard tidak valid.');
    clipboard.writeText(text); return true;
  });
  ipcMain.handle('zivar:extension-folder', async event => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    const error = await shell.openPath(extensionDirectory); if (error) throw new Error(error); return true;
  });
  ipcMain.handle('zivar:setup-complete', async event => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    const destination = path.join(dataDirectory, 'setup-completed.json');
    await fs.writeFile(destination + '.tmp', JSON.stringify({ version: 1, completedAt: new Date().toISOString() }));
    await fs.rename(destination + '.tmp', destination);
    setupPending = false; return true;
  });
  // Open/show only files that live inside the download folder. Programs and
  // scripts are never launched from here; they are only shown in Explorer.
  const insideDownloads = async target => {
    const base = path.resolve(service.downloadDirectory), full = path.resolve(String(target || ''));
    if (!full.startsWith(base + path.sep)) throw new Error('Lokasi file tidak diizinkan.');
    await fs.access(full).catch(() => { throw new Error('File tidak ditemukan. Mungkin sudah dipindahkan atau dihapus.'); });
    return full;
  };
  const runnable = /\.(exe|msi|msix|appx|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|reg|jar|cpl|dll|url|sh|bash|run|appimage|deb|rpm|dmg|pkg|app|command|desktop|bin)$/i;
  ipcMain.handle('zivar:open-file', async (event, target) => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    const full = await insideDownloads(target);
    if (runnable.test(full)) { shell.showItemInFolder(full); return 'shown'; }
    const error = await shell.openPath(full); if (error) throw new Error(error); return 'opened';
  });
  ipcMain.handle('zivar:show-file', async (event, target) => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    shell.showItemInFolder(await insideDownloads(target)); return true;
  });
  ipcMain.handle('zivar:get-system', event => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    return { autoStart: process.env.ZIVAR_DESKTOP_TEST_MODE === '1' ? false : getAutoStart(), activeProxy: activeProxy(), portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE) };
  });
  ipcMain.handle('zivar:set-autostart', (event, enabled) => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    if (process.env.ZIVAR_DESKTOP_TEST_MODE === '1') { record(`autostart:${Boolean(enabled)}`); return Boolean(enabled); }
    return setAutoStart(enabled);
  });
  ipcMain.handle('zivar:check-update', async event => { if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.'); return checkUpdate(); });
  ipcMain.handle('zivar:download-update', async event => { if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.'); return downloadUpdate(); });
  ipcMain.handle('zivar:relaunch', event => {
    if (!trusted(event)) throw new Error('Pengirim tidak diizinkan.');
    if (process.env.ZIVAR_DESKTOP_TEST_MODE === '1') { record('relaunch'); return false; }
    relaunchWithProxy(savedProxy()); quitting = true; setImmediate(() => app.quit()); return true;
  });
  ipcMain.handle('zivar:quit',event => { if (trusted(event)) { quitting = true; setImmediate(() => app.quit()); } });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 650,
    title: 'ZIVAR Download Manager', backgroundColor: '#1d1e21',
    icon: path.join(directory, 'assets', 'app.png'), show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (target !== service.origin + '/') event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  // Started by the OS at login with --hidden: stay in the tray.
  window.once('ready-to-show', () => { if (!startHidden) showWindow(); });
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault(); window.hide();
    if (!shownTrayNotice && process.env.ZIVAR_DESKTOP_TEST_MODE !== '1' && Notification.isSupported()) {
      shownTrayNotice = true;
      new Notification({ title: 'ZIVAR masih berjalan', body: 'Unduhan berlanjut di latar belakang. Buka ikon ZIVAR di system tray untuk kembali atau keluar.', icon: path.join(directory, 'assets', 'app.png') }).show();
    }
  });
  window.loadURL(service.origin + '/').catch(async error => { await log(error); dialog.showErrorBox('ZIVAR tidak dapat dibuka', error.message); quitting = true; app.quit(); });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(directory, 'assets', 'app.png')).resize({ width: 24, height: 24 }));
  tray.setToolTip('ZIVAR Download Manager');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Buka ZIVAR', click: showWindow },
    { label: 'Folder unduhan', click: () => shell.openPath(service.downloadDirectory) },
    { label: 'Folder ekstensi Chrome', click: () => shell.openPath(extensionDirectory) },
    { type: 'separator' },
    { label: 'Keluar', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showWindow); tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.zivar.downloadmanager');
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    quitting = true;
    clearInterval(clipboardTimer); clipboardTimer = null;
    if (shutdownStarted) return;
    event.preventDefault(); shutdownStarted = true;
    Promise.resolve(service?.close()).catch(log).finally(() => { tray?.destroy(); app.quit(); });
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    service = await bootService();
    // Portable resources are temporary; Chrome needs a stable extension folder.
    await fs.mkdir(extensionDirectory, { recursive: true });
    await fs.cp(bundledExtensionDirectory, extensionDirectory, { recursive: true, force: true });
    setupPending = process.argv.includes('--show-setup') || !await fs.access(path.join(dataDirectory, 'setup-completed.json')).then(() => true, () => false);
    installBridge(); createWindow(); createTray(); startClipboardMonitor(); watchJobs();
    setTimeout(() => backgroundUpdateCheck().catch(log), 60_000).unref?.();
  }).catch(async error => {
    await log(error);
    dialog.showErrorBox('ZIVAR tidak dapat dimulai', error.code === 'EADDRINUSE' ? 'Port 18765 sedang dipakai aplikasi lain. Tutup aplikasi yang memakai port tersebut, lalu buka ZIVAR kembali.' : error.message);
    quitting = true; app.quit();
  });
}



