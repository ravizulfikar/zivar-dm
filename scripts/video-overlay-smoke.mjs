import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import { startServer } from '../app/server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(project, 'tests', '.tmp');
await fs.mkdir(temporaryRoot, { recursive: true });
const temporary = await fs.mkdtemp(path.join(temporaryRoot, 'overlay-'));
await fs.mkdir(path.join(project, 'artifacts'), { recursive: true });
let videoBytes = Buffer.alloc(0), context;
const requests = [];
let refused = 0, hlsDirectory = '';
const pageHtml = '<!doctype html><meta charset="utf-8"><title>Contoh pemutar video</title><h2>Contoh video lokal</h2><div id="player"><video id="main" width="640" height="360" controls muted loop preload="metadata" src="/media.webm"></video></div>';
const blankHtml = '<!doctype html><meta charset="utf-8"><title>Contoh pemutar</title><video id="main" width="640" height="360" controls muted loop></video>';
const source = http.createServer((req, res) => {
  requests.push({ url: req.url, referer: req.headers.referer });
  if (req.url === '/page' || req.url === '/unknown' || req.url === '/frame-page') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'none'; media-src 'self' blob:; frame-src 'self'");
    return res.end(req.url === '/unknown' ? blankHtml : pageHtml.replaceAll('/media.webm', req.url === '/frame-page' ? '/other.webm' : '/media.webm'));
  }
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  // Encrypted HLS that, like a strict CDN, refuses anything but the browser.
  if (req.url.startsWith('/hls-only/')) {
    if (!/[a-z]{2}/i.test(req.headers['accept-language'] || '')) { refused++; res.writeHead(403); return res.end('Access Denied'); }
    const name = path.basename(req.url.split('?')[0]);
    if (name === 'master.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=320x180,CODECS="avc1.42c00d"\nv.m3u8\n'); }
    return fs.readFile(path.join(hlsDirectory, name)).then(bytes => { res.setHeader('Content-Type', name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream'); res.end(bytes); }, () => { res.writeHead(404); res.end(); });
  }
  if (req.url === '/browser-only-page') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(pageHtml.replaceAll('/media.webm', '/browser-only.webm')); }
  // Like vidio.com's CDN: only the real browser gets the file (Node/FFmpeg send no real Accept-Language; undici sends '*').
  if (req.url.startsWith('/browser-only.webm') && !/[a-z]{2}/i.test(req.headers['accept-language'] || '')) { refused++; res.writeHead(403); return res.end('Access Denied'); }
  if (req.url === '/playlist') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360,CODECS="avc1.4d401e"\n/v360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\n/v720.m3u8\n'); }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), videoBytes.length - 1) : videoBytes.length - 1;
  const headers = { 'Content-Type': 'video/webm', 'Content-Length': end - start + 1, ETag: '"overlay-fixture"' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${videoBytes.length}`;
  res.writeHead(range ? 206 : 200, headers); res.end(videoBytes.subarray(start, end + 1));
});
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${source.address().port}`;
const app = await startServer({ port: 0, dataDirectory: path.join(temporary, 'state'), downloadDirectory: path.join(temporary, 'downloads') });
const until = async predicate => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 15000) throw new Error('Overlay operation timed out.'); await new Promise(resolve => setTimeout(resolve, 30)); } };
const panel = page => page.locator('[data-zivar-video-panel]');
const primary = page => panel(page).locator('button[data-action="download"]');
async function blobPlay(page) {
  await page.locator('video').evaluate(async (video, bytes) => { video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' })); await video.play(); }, [...videoBytes]);
}
try {
  const extension = path.join(temporary, 'extension');
  await fs.cp(path.join(project, 'extension'), extension, { recursive: true });
  const background = path.join(extension, 'background.js');
  await fs.writeFile(background, (await fs.readFile(background, 'utf8')).replace("'http://127.0.0.1:18765'", JSON.stringify(app.origin)));
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const generator = await context.newPage();
  videoBytes = Buffer.from(await generator.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    document.body.append(canvas);
    const drawing = canvas.getContext('2d', { alpha: false }), stream = canvas.captureStream(30), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = event => chunks.push(event.data);
    const result = new Promise(resolve => recorder.onstop = async () => resolve([...new Uint8Array(await new Blob(chunks).arrayBuffer())]));
    let frame = 0;
    const track = stream.getVideoTracks()[0];
    const paint = () => { drawing.fillStyle = '#e5e9ee'; drawing.fillRect(0, 0, 320, 180); drawing.fillStyle = '#245b91'; drawing.fillRect(15 + frame++ % 20 * 6, 65, 100, 50); track.requestFrame?.(); };
    paint(); recorder.start(); const timer = setInterval(paint, 40); await new Promise(resolve => setTimeout(resolve, 1500)); recorder.stop();
    const bytes = await result; clearInterval(timer); stream.getTracks().forEach(track => track.stop()); return bytes;
  }));
  assert.ok(videoBytes.length > 1000); await fs.writeFile(path.join(project, 'artifacts', 'overlay-fixture.webm'), videoBytes); await generator.close();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#token').fill(app.token); await popup.getByRole('button', { name: 'Hubungkan', exact: true }).click();
  await popup.locator('#status').filter({ hasText: 'Terhubung ke aplikasi lokal' }).waitFor();
  const page = await context.newPage(); await page.goto(origin + '/page');
  await page.locator('video').evaluate(async video => { await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0);
  await page.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor();
  assert.equal(await panel(page).evaluate(host => getComputedStyle(host).position), 'fixed', 'Overlay must work under strict page CSP');
  await primary(page).evaluate(button => button.click());
  await page.waitForTimeout(300); assert.equal(app.manager.jobs.length, 0, 'A website-generated synthetic click must not start a download');
  await primary(page).click();
  await until(() => app.manager.jobs[0]?.status === 'completed');
  assert.equal(app.manager.jobs[0].url, origin + '/media.webm');
  assert.deepEqual(await fs.readFile(app.manager.jobs[0].outputPath), videoBytes);
  await page.screenshot({ path: path.join(project, 'artifacts', 'video-overlay.png') });

  await page.evaluate(() => { document.body.style.height = '1800px'; document.querySelector('video').style.marginTop = '140px'; scrollTo(0, 80); });
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-zivar-video-panel]').getBoundingClientRect().top - document.querySelector('video').getBoundingClientRect().top - 8) < 2);
  await page.evaluate(() => scrollTo(0, 1200)); await panel(page).waitFor({ state: 'hidden' });
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('video').style.marginTop = ''; }); await panel(page).waitFor({ state: 'visible' });

  await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.id = 'other-player'; iframe.src = '/frame-page'; iframe.width = '700'; iframe.height = '450'; document.body.append(iframe); });
  const frame = page.frameLocator('#other-player'); await page.locator('#other-player').scrollIntoViewIfNeeded();
  await frame.locator('video').evaluate(video => video.play());
  await frame.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor();
  await frame.locator('[data-zivar-video-panel]').locator('button[data-action="download"]').click();
  await until(() => app.manager.jobs.some(job => job.url.endsWith('/other.webm') && job.status === 'completed'));
  assert.ok(requests.some(request => request.url === '/other.webm' && request.referer === origin + '/frame-page'), 'A frame download must use its own document referrer');

  await page.locator('video').evaluate(video => video.remove()); await panel(page).waitFor({ state: 'detached' });
  await page.evaluate(() => { const video = document.createElement('video'); video.src = '/media.webm'; video.width = 640; video.height = 360; video.muted = true; video.loop = true; document.querySelector('#player').append(video); });
  await page.locator('video').scrollIntoViewIfNeeded(); await page.locator('video').evaluate(video => video.play());
  await page.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor(); assert.equal(await panel(page).count(), 1);
  await page.locator('video').evaluate(async video => {
    video.pause(); video.removeAttribute('src'); video.replaceChildren(...['/media.webm', '/other.webm'].map(url => { const source = document.createElement('source'); source.src = url; return source; })); video.load(); await video.play();
  });
  await page.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-zivar-video-panel]')?.shadowRoot?.querySelector('button[data-action="download"]')?.textContent === 'Pilih kualitas');
  await primary(page).click(); await panel(page).getByText('Unduh semua (2)', { exact: false }).waitFor();
  await page.mouse.click(20, 20);
  await page.reload(); await page.locator('video').evaluate(video => video.play());
  await page.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor();

  const unknown = await context.newPage(); await unknown.goto(origin + '/unknown'); await blobPlay(unknown);
  await unknown.locator('[data-zivar-video-panel][data-zivar-state="unsupported"]').waitFor();
  const beforeUnsupported = app.manager.jobs.length; await primary(unknown).click();
  await panel(unknown).getByText('URL video langsung belum ditemukan.', { exact: false }).waitFor(); assert.equal(app.manager.jobs.length, beforeUnsupported);
  await unknown.evaluate(() => fetch('/playlist'));
  await panel(unknown).getByText('Varian kualitas terdeteksi.', { exact: false }).waitFor();
  // The menu is still open from the click above; clicking again would close it.
  await panel(unknown).getByText('v720.m3u8', { exact: false }).waitFor(); assert.equal(app.manager.jobs.length, beforeUnsupported);
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: blankHtml }));
  const youtube = await context.newPage(); await youtube.goto('https://www.youtube.com/zivar-local-test'); await blobPlay(youtube);
  await youtube.locator('[data-zivar-video-panel][data-zivar-state="unsupported"]').waitFor();
  await primary(youtube).click(); await panel(youtube).getByText('URL video langsung belum ditemukan.', { exact: false }).waitFor(); assert.equal(app.manager.jobs.length, beforeUnsupported);

  // A CDN that refuses ZIVAR but serves Chrome: the extension downloads it through the browser.
  const browserOnly = await context.newPage(); await browserOnly.goto(origin + '/browser-only-page');
  await browserOnly.locator('video').evaluate(video => video.play());
  await browserOnly.locator('[data-zivar-video-panel][data-zivar-state="ready"]').waitFor();
  await primary(browserOnly).click();
  await until(() => app.manager.jobs.some(job => job.kind === 'browser' && job.status === 'completed'));
  const browserJob = app.manager.jobs.find(job => job.kind === 'browser');
  assert.deepEqual(await fs.readFile(browserJob.outputPath), videoBytes, 'Browser-assisted download must be byte-exact');
  assert.ok(refused > 0, 'The CDN must have refused ZIVAR before Chrome took over');
  // Encrypted (AES-128) HLS through Chrome: segments are fetched and decrypted by the extension.
  hlsDirectory = path.join(temporary, 'hls'); await fs.mkdir(hlsDirectory, { recursive: true });
  await fs.writeFile(path.join(hlsDirectory, 'source.webm'), videoBytes);
  await fs.writeFile(path.join(hlsDirectory, 'key.bin'), Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  await fs.writeFile(path.join(hlsDirectory, 'keyinfo.txt'), `key.bin\n${path.join(hlsDirectory, 'key.bin')}\n`);
  const encode = spawnSync(path.join(project, 'vendor', 'ffmpeg', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(hlsDirectory, 'source.webm'), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '6', '-an', '-f', 'hls', '-hls_time', '0.3', '-hls_list_size', '0', '-hls_key_info_file', path.join(hlsDirectory, 'keyinfo.txt'), '-hls_segment_filename', path.join(hlsDirectory, 'seg%03d.ts'), path.join(hlsDirectory, 'v.m3u8')], { encoding: 'utf8' });
  assert.equal(encode.status, 0, encode.stderr);
  assert.match(await fs.readFile(path.join(hlsDirectory, 'v.m3u8'), 'utf8'), /METHOD=AES-128/);
  const hlsPage = await context.newPage(); await hlsPage.goto(origin + '/unknown'); await blobPlay(hlsPage);
  await hlsPage.evaluate(() => fetch('/hls-only/master.m3u8'));
  await hlsPage.waitForFunction(() => [...document.querySelectorAll('[data-zivar-video-panel]:not([hidden])')].some(host => host.shadowRoot.querySelector('.menu').textContent.includes('v.m3u8')));
  await primary(hlsPage).click();
  await panel(hlsPage).locator('button.media', { hasText: 'v.m3u8' }).click();
  await until(() => app.manager.jobs.some(job => job.kind === 'browser' && job.sourceUrls?.[0]?.includes('/hls-only/') && ['completed', 'error'].includes(job.status)));
  const hlsJob = app.manager.jobs.find(job => job.kind === 'browser' && job.sourceUrls?.[0]?.includes('/hls-only/'));
  assert.equal(hlsJob.status, 'completed', hlsJob.error);
  const probe = spawnSync(path.join(project, 'vendor', 'ffmpeg', 'ffmpeg.exe'), ['-hide_banner', '-i', hlsJob.outputPath], { encoding: 'utf8' }).stderr;
  assert.match(probe, /Video: h264/, 'Decrypted HLS must become a playable H.264 MP4');
  const decode = spawnSync(path.join(project, 'vendor', 'ffmpeg', 'ffmpeg.exe'), ['-v', 'error', '-i', hlsJob.outputPath, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(decode.stderr.trim(), '', 'MP4 from HLS must decode without errors');
  const beforeUnsupportedAds = app.manager.jobs.length;

  // vidio.com-style page: main player uses blob/MSE, an ad plays as a plain MP4 in a second <video> on top.
  const adPage = await context.newPage(); await adPage.goto(origin + '/unknown'); await blobPlay(adPage);
  await adPage.evaluate(async () => { const ad = document.createElement('video'); ad.src = '/ads/assets/preroll.webm'; ad.muted = true; ad.width = 640; ad.height = 360; Object.assign(ad.style, { position: 'absolute', left: '8px', top: '8px' }); document.body.append(ad); await ad.play(); });
  await adPage.evaluate(() => fetch('/playlist'));
  const visiblePanel = adPage.locator('[data-zivar-video-panel]:not([hidden])');
  await adPage.waitForFunction(() => [...document.querySelectorAll('[data-zivar-video-panel]:not([hidden])')].some(host => host.shadowRoot.querySelector('.menu').textContent.includes('v720.m3u8')), null, { timeout: 15000 });
  assert.equal(await visiblePanel.count(), 1, 'Only the main player may show a ZIVAR button; the ad player must not');
  const adMenu = await visiblePanel.evaluate(host => host.shadowRoot.querySelector('.menu').textContent);
  assert.ok(adMenu.includes('v720.m3u8') && !adMenu.includes('preroll'), `Ad must not be offered: ${adMenu}`);
  assert.equal(app.manager.jobs.length, beforeUnsupportedAds);

  await app.close(); await page.bringToFront(); await page.locator('video').scrollIntoViewIfNeeded(); await primary(page).click();
  const offlineChoice = panel(page).locator('button.media:not(.all)').first(); if (await offlineChoice.isVisible().catch(() => false)) await offlineChoice.click();
  await page.getByText('Aplikasi lokal belum terhubung.', { exact: false }).waitFor();
  console.log('PASS: real video playback, overlay under strict CSP, one-click exact download, synthetic-click rejection, scroll/hide, iframe association/referrer, dynamic players, honest blob/non-video-page limits, ad players ignored, browser-only CDN downloaded through Chrome, encrypted HLS through Chrome, offline error.');
} finally {
  await context?.close(); await app.close(); source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
  if (path.dirname(path.resolve(temporary)) !== path.resolve(temporaryRoot)) throw new Error('Unsafe overlay test cleanup path');
  await fs.rm(temporary, { recursive: true, force: true });
}
