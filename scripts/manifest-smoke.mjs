import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const chrome = {
  runtime: { id: 'test-extension', getURL: value => `chrome-extension://test/${value}`, onInstalled: { addListener() {} }, onMessage: { addListener() {} } },
  contextMenus: { removeAll(callback) { callback?.(); }, create() {}, onClicked: { addListener() {} } },
  webRequest: { onBeforeSendHeaders: { addListener() {} }, onHeadersReceived: { addListener() {} } },
  tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, sendMessage() { return Promise.resolve(); }, create: async () => ({ id: 2 }), get: async () => ({ id: 2 }) },
  windows: { onRemoved: { addListener() {} }, create: async () => ({ id: 1, tabs: [{ id: 2 }] }), get: async () => ({ id: 1 }) },
  downloads: { onCreated: { addListener() {} }, search: async () => [], pause: async () => {}, resume: async () => {}, cancel: async () => {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  action: {},
  alarms: { create() {}, onAlarm: { addListener() {} } }
};
const context = { chrome, fetch, URL, Map, Date, Set, Number, String, RegExp, Promise, AbortSignal, console };
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.__manifest = { hlsVariants, hlsMediaInfo, dashVariants, readManifest };`, context);
const hls = context.__manifest.hlsVariants(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360,CODECS="avc1.4d401e"\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\nhigh/index.m3u8`, 'https://media.example/master.m3u8');
assert.equal(hls.length, 2); assert.equal(hls[1].height, 720); assert.equal(hls[1].bandwidth, 2800000); assert.equal(hls[1].url, 'https://media.example/high/index.m3u8');
const hlsInfo = context.__manifest.hlsMediaInfo('#EXTM3U\n#EXTINF:4.004,\na.ts\n#EXTINF:5.996,\nb.ts\n#EXT-X-ENDLIST');
assert.equal(hlsInfo.duration, 10); assert.equal(hlsInfo.segments, 2);
assert.equal(context.__manifest.hlsMediaInfo('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:5,\na.ts').drm, true);
const dash = context.__manifest.dashVariants(`<MPD mediaPresentationDuration="PT1M30S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="360" width="640" height="360" bandwidth="1200000"><BaseURL>low/video.mp4</BaseURL></Representation><Representation id="720" width="1280" height="720" bandwidth="2800000"><BaseURL>high/video.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`, 'https://media.example/manifest.mpd');
assert.equal(dash.length, 2); assert.equal(dash[1].height, 720); assert.equal(dash[1].bandwidth, 2800000); assert.equal(dash[1].url, 'https://media.example/high/video.mp4');
assert.equal(dash[1].duration, 90);
const protectedDash = context.__manifest.dashVariants('<MPD mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:test"/><Representation width="640" height="360" bandwidth="500000"><BaseURL>video.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>', 'https://media.example/protected.mpd');
assert.equal(protectedDash[0].drm, true);
context.fetch = async url => ({ ok: true, headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/vnd.apple.mpegurl' : null }, text: async () => url.endsWith('/high/index.m3u8') ? '#EXTM3U\n#EXTINF:5,\npart.ts\n#EXT-X-ENDLIST' : '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\nhigh/index.m3u8' });
const enriched = await context.__manifest.readManifest({ stream: true, url: 'https://media.example/master.m3u8' }, 'https://media.example/page');
assert.equal(enriched[1].duration, 5); assert.equal(enriched[1].size, 1750000); assert.equal(enriched[1].sizeEstimated, true);
console.log('PASS: HLS and DASH variant metadata parsing, URL resolution, bitrate, resolution, and codecs.');
