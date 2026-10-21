// Real Firefox: installs dist/firefox-extension as a temporary add-on over WebDriver BiDi,
// pairs it, then downloads (1) a normal video and (2) a browser-only video through Firefox.
// Run scripts/build-firefox.mjs first. Requires Firefox 138+ (webExtension.install).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../app/server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firefox = process.env.FIREFOX_EXE || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const root = path.join(project, 'tests', '.tmp');
await fs.mkdir(root, { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, 'firefox-'));
const ffmpeg = path.join(project, 'vendor', 'ffmpeg', 'ffmpeg.exe');
const videoFile = path.join(temporary, 'clip.webm');
const encode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', videoFile], { encoding: 'utf8' });
assert.equal(encode.status, 0, encode.stderr);
const video = await fs.readFile(videoFile);
let refused = 0;
const source = http.createServer((req, res) => {
  if (!/\.webm$|-page$/.test(req.url)) { res.writeHead(404); return res.end(); }
  if (req.url.endsWith('-page')) { res.setHeader('Content-Type', 'text/html'); return res.end(`<!doctype html><title>Firefox fixture</title><video id="v" width="640" height="360" muted loop autoplay src="/${req.url.startsWith('/locked') ? 'locked' : 'open'}.webm"></video>`); }
  if (req.url.startsWith('/locked') && !/[a-z]{2}/i.test(req.headers['accept-language'] || '')) { refused++; res.writeHead(403); return res.end(); }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
  const headers = { 'Content-Type': 'video/webm', 'Content-Length': end - start + 1, ETag: '"ff"', 'Accept-Ranges': 'bytes' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${video.length}`;
  res.writeHead(range ? 206 : 200, headers); res.end(video.subarray(start, end + 1));
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${source.address().port}`;
const app = await startServer({ port: 0, dataDirectory: path.join(temporary, 'state'), downloadDirectory: path.join(temporary, 'downloads') });

// The add-on talks to the app at the address baked into background.js; point the test copy at our server.
const extension = path.join(temporary, 'extension');
await fs.cp(path.join(project, 'dist', 'firefox-extension'), extension, { recursive: true });
const background = path.join(extension, 'background.js');
// BiDi cannot open moz-extension:// pages, so the test copy is pre-paired with the app's token.
await fs.writeFile(background, `chrome.storage.local.set({ token: ${JSON.stringify(app.token)} });\n` + (await fs.readFile(background, 'utf8')).replace("'http://127.0.0.1:18765'", JSON.stringify(app.origin)));
const uuid = randomUUID();
const profile = path.join(temporary, 'profile'); await fs.mkdir(profile);
await fs.writeFile(path.join(profile, 'user.js'), [
  `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'companion@zivar.local': uuid }))});`,
  'user_pref("media.autoplay.default", 0);', 'user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("app.update.enabled", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);', 'user_pref("toolkit.telemetry.enabled", false);', 'user_pref("browser.startup.homepage_override.mstone", "ignore");',
].join('\n'));
const port = 9200 + Math.floor(Math.random() * 600);
const child = spawn(firefox, ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let socket, nextId = 1, logs = '';
child.stderr.on('data', data => { logs = (logs + data).slice(-20000); }); child.stdout.on('data', data => { logs = (logs + data).slice(-20000); });
const waiting = new Map();
let step = 'start';
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; step = method; const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Firefox did not answer ${method}`)); }, 90000); waiting.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
const until = async (check, ms = 20000) => { const start = Date.now(); for (;;) { const value = await check(); if (value) return value; if (Date.now() - start > ms) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 200)); } };
try {
  // Firefox prints the BiDi address once it is listening.
  step = 'waiting for Firefox';
  await until(() => /WebDriver BiDi listening/.test(logs), 45000).catch(() => { throw new Error('Firefox did not start BiDi: ' + logs.slice(-800)); });
  socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(event.data); const entry = waiting.get(message.id); if (!entry) return; waiting.delete(message.id); message.type === 'error' ? entry.reject(new Error(`${message.error}: ${message.message}`)) : entry.resolve(message.result); };
  await send('session.new', { capabilities: {} });
  await send('webExtension.install', { extensionData: { type: 'path', path: extension } });
  const { contexts } = await send('browsingContext.getTree', {});
  const context = contexts[0].context;
  const evaluate = async expression => (await send('script.evaluate', { expression, target: { context }, awaitPromise: true })).result?.value;
  const go = url => send('browsingContext.navigate', { context, url, wait: 'complete' });


  const clickPrimary = async () => {
    const box = await until(() => evaluate(`(() => { const host = [...document.querySelectorAll('[data-zivar-video-panel]')].find(h => !h.hidden && h.dataset.zivarState === 'ready'); if (!host) return null; const r = host.shadowRoot.querySelector('.primary').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`), 30000);
    const { x, y } = JSON.parse(box);
    await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x, y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
  };
  // 1) Normal video: overlay button → app downloads it.
  await go(`${origin}/open-page`);
  await clickPrimary();
  const normal = await until(() => app.manager.jobs.find(job => job.url.endsWith('/open.webm') && job.status === 'completed')).catch(async error => {
    const toasts = await evaluate(`[...document.documentElement.children].filter(n => n.localName === 'div' && !n.dataset.zivarVideoPanel).map(n => n.textContent).join(' | ')`);
    const panelState = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-zivar-video-panel]')].map(h => [h.dataset.zivarState, h.hidden, h.shadowRoot.querySelector('.label').textContent, h.shadowRoot.querySelector('.menu').textContent.slice(0, 200)]))`);
    throw new Error(`${error.message}; toasts: ${toasts}; panels: ${panelState}; jobs: ${JSON.stringify(app.manager.jobs.map(job => [job.url, job.status, job.error]))}`);
  });
  assert.deepEqual(await fs.readFile(normal.outputPath), video);
  const state = await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } }).then(r => r.json());
  assert.equal(state.browserIntegration.connected, true, 'App must see the Firefox add-on (moz-extension origin accepted)');
  // 2) Browser-only video: app is refused, Firefox downloads it itself.
  await go(`${origin}/locked-page`);
  await clickPrimary();
  const locked = await until(() => app.manager.jobs.find(job => job.kind === 'browser' && ['completed', 'error'].includes(job.status)), 30000);
  assert.equal(locked.status, 'completed', locked.error);
  assert.deepEqual(await fs.readFile(locked.outputPath), video);
  assert.ok(refused > 0);
  console.log('PASS: Firefox add-on installs, connects to the app, overlay downloads a video, and browser-only video is fetched by Firefox.');
} catch (error) { console.error('FAILED at step', step, '-', error.message); console.error('FIREFOX LOG:', logs.slice(-2500)); throw error;
} finally {
  try { await send('session.end', {}); } catch {}
  socket?.close(); child.kill();
  await new Promise(resolve => setTimeout(resolve, 1500));
  await app.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(root)) throw new Error('Unsafe firefox test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
}
