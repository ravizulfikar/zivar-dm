const $ = selector => document.querySelector(selector);
let activeTab;
const message = (text, error = false) => { $('#message').textContent = text; $('#message').classList.toggle('error', error); };
const mediaFormat = entry => { const mime = String(entry.mime || '').split(';')[0].toLowerCase(); if (mime.includes('webm') || /\.webm(?:[?#]|$)/i.test(entry.url)) return 'WebM'; if (mime.includes('mp4') || /\.mp4(?:[?#]|$)/i.test(entry.url)) return 'MP4'; return mime.replace(/^video\//, '').toUpperCase(); };
const mediaQuality = entry => { const match = /(?:^|[?&_/-])(?:quality|res|height)?[=_-]([1-9]\d{2,4})p?(?:[&#_/.-]|$)/i.exec(entry.url); const value = Number(entry.height) || Number(match?.[1]); return value ? `${value}p` : ''; };
const mediaBitrate = entry => { const value = Number(entry.averageBandwidth || entry.bandwidth || entry.bitrate); return Number.isFinite(value) && value > 0 ? (value >= 1000000 ? `${(value / 1000000).toFixed(2)} Mbps` : `${Math.round(value / 1000)} kbps`) : ''; };
const mediaDuration = entry => { const value = Number(entry.duration); if (!Number.isFinite(value) || value <= 0) return ''; const total = Math.round(value); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
const mediaSize = entry => { const value = Number(entry.size); if (!Number.isFinite(value) || value <= 0) return ''; return `${entry.sizeEstimated ? '~' : ''}${(value / 1048576).toFixed(1)} MB`; };
async function send(data) { const result = await chrome.runtime.sendMessage(data); if (!result?.ok) throw new Error(result?.error || 'Ekstensi tidak merespons.'); return result; }
async function check() {
  try { await send({ type: 'STATUS' }); $('#status').textContent = 'Terhubung ke aplikasi lokal'; $('#status').className = 'status online'; $('#pairing').open = false; }
  catch (error) { $('#status').textContent = error.message; $('#status').className = 'status offline'; $('#pairing').open = true; }
}
async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); activeTab = tab;
  $('#page-title').textContent = tab?.title || '';
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: 'SCAN' }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 250));
  const key = `media:${tab.id}`, stored = await chrome.storage.session.get(key);
  const entries = stored[key] || []; $('#media').replaceChildren(); $('#empty').hidden = entries.length > 0;
  const youtube = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(new URL(tab.url || 'https://invalid.local').hostname);
  for (const entry of entries) {
    const box = $('#media-item').content.firstElementChild.cloneNode(true);
    const pill = box.querySelector('.pill'), name = box.querySelector('strong'), description = box.querySelector('p'), button = box.querySelector('button');
    pill.textContent = entry.ad ? 'Iklan' : mediaQuality(entry) || mediaFormat(entry) || (entry.stream ? 'Stream' : 'File');
    pill.classList.toggle('muted', !entry.ad && !mediaQuality(entry)); pill.classList.toggle('ad', Boolean(entry.ad));
    try { const url = new URL(entry.url); name.textContent = decodeURIComponent(url.pathname.split('/').pop()) || url.hostname; } catch { name.textContent = 'Video terdeteksi'; }
    name.title = name.textContent;
    let host = ''; try { host = new URL(entry.url).hostname; } catch {}
    description.textContent = [host, mediaFormat(entry), entry.mime?.split(';')[0], mediaBitrate(entry), entry.codecs ? `Codec ${entry.codecs}` : '', mediaSize(entry), mediaDuration(entry)].filter(Boolean).join(' · ');
    const note = text => { button.remove(); const label = document.createElement('span'); label.className = 'unsupported'; label.textContent = text; box.append(label); };
    if (entry.ad) note('Iklan — tidak diunduh');
    else if (entry.stream || youtube) note(youtube ? 'YouTube: pilih kualitas lewat tombol ZIVAR di pemutar.' : 'Stream HLS/DASH: pilih kualitas lewat tombol ZIVAR di pemutar.');
    else button.addEventListener('click', async () => { button.disabled = true; try { await send({ type: 'SEND', url: entry.url, referrer: activeTab?.url, tabId: activeTab?.id }); message('Video ditambahkan ke antrean aplikasi.'); } catch (error) { message(error.message, true); } finally { button.disabled = false; } });
    $('#media').append(box);
  }
}
$('#pair-form').addEventListener('submit', async event => { event.preventDefault(); try { await send({ type: 'PAIR', token: $('#token').value.trim() }); $('#token').value = ''; message('Berhasil terhubung.'); await check(); } catch (error) { message(error.message, true); } });
$('#link-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; try { await send({ type: 'SEND', url: $('#url').value.trim(), referrer: activeTab?.url, tabId: activeTab?.id }); $('#url').value = ''; message('Tautan dikirim ke aplikasi.'); } catch (error) { message(error.message, true); } finally { button.disabled = false; } });
$('#capture').addEventListener('change', () => chrome.storage.local.set({ captureDownloads: $('#capture').checked }));
$('#refresh').addEventListener('click', () => refresh().catch(error => message(error.message, true)));
$('#open-app').addEventListener('click', async () => {
  try { const result = await send({ type: 'OPEN_APP' }); if (!result.data.desktop) await chrome.tabs.create({ url: 'http://127.0.0.1:18765' }); }
  catch (error) { message(error.message, true); }
});
chrome.storage.local.get(['captureDownloads', 'lastError']).then(data => { $('#capture').checked = data.captureDownloads !== false; if (data.lastError) message(data.lastError, true); });
check(); refresh().catch(error => message(error.message, true));
