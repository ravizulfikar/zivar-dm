import { BrowserWindow } from 'electron';
import { splashHtml } from './splashContent.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A small frameless window with the animated start-up page. It takes no part in anything else the app does:
 * `dismiss()` keeps it up for the minimum time, plays the short fade-out and closes it.
 */
export function openSplash({ icon, ...content }) {
  const win = new BrowserWindow({
    width: 480, height: 340, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, center: true, icon,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml(content))).catch(() => {});

  // Resolves with the time it became visible; resolves anyway if the page cannot be drawn (no compositor,
  // a broken driver) so the app never waits for it.
  const shown = new Promise(resolve => {
    win.once('ready-to-show', () => { win.show(); resolve(Date.now()); });
    setTimeout(() => resolve(Date.now()), 3000);
  });
  let closing = null;
  const dismiss = (minMs = 0) => closing ??= (async () => {
    const since = await shown;
    await sleep(Math.max(0, since + minMs - Date.now()));
    if (win.isDestroyed()) return;
    await win.webContents.executeJavaScript("document.body.classList.add('leave')").catch(() => {});
    await sleep(280);
    if (!win.isDestroyed()) win.close();
  })();
  // A splash that nobody dismisses (the main window never got ready) must not stay up forever.
  setTimeout(() => { dismiss(0); }, 30_000).unref?.();
  return { window: win, shown, dismiss };
}
