const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const id = Number(params.get('id'));
let record = null, networks = null;
document.querySelector('.status-label').textContent = `v${chrome.runtime.getManifest().version}`;

const send = async data => {
  const result = await chrome.runtime.sendMessage(data);
  if (!result?.ok) throw new Error(result?.error || ZI.t('ext.noResponse'));
  return result.data;
};
const bytes = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return ZI.t('info.unknown');
  if (number < 1024) return `${number} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let size = number, index = -1;
  do { size /= 1024; index++; } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
};

// A tile in the colour of the file's kind, like the categories in the app.
const KINDS = {
  archive: /^(zip|rar|7z|tar|gz|bz2|xz|iso|img|cab|zst|r\d+)$/, program: /^(exe|msi|msix|apk|dmg|pkg|deb|rpm|appimage|bat|sh)$/,
  video: /^(mp4|mkv|avi|mov|wmv|webm|m4v|flv|mpg|mpeg|3gp)$/, audio: /^(mp3|flac|wav|aac|m4a|ogg|opus|wma)$/,
  image: /^(jpg|jpeg|png|gif|webp|bmp|svg|tif|tiff|heic)$/, document: /^(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|odt|epub|csv)$/,
};
const TILE = {
  archive: '<rect x="4" y="3.5" width="16" height="17" rx="2.6"/><path d="M12 3.5v4M12 9.5v2M12 13.5v1.5"/><rect x="10" y="15" width="4" height="3" rx=".9"/>',
  program: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 9h17"/><path d="M9.5 12.8l-1.8 1.8 1.8 1.8M14.5 12.8l1.8 1.8-1.8 1.8"/>',
  video: '<rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="M10.2 9.4v5.2l4.4-2.6z"/>',
  audio: '<path d="M9 17.5V6.5l9-2v11"/><circle cx="6.8" cy="17.5" r="2.2"/><circle cx="15.8" cy="15.5" r="2.2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4"/>',
  document: '<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8H18M8.5 12.5h7M8.5 16h5"/>',
  other: '<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5V8H18"/>',
};
function drawTile(filename) {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(String(filename || ''))?.[1].toLowerCase() || '';
  const kind = Object.keys(KINDS).find(name => KINDS[name].test(extension)) || 'other';
  const tile = $('#file-tile'); tile.dataset.kind = kind;
  tile.innerHTML = `<svg viewBox="0 0 24 24">${TILE[kind]}</svg>`;
}

const showError = message => { $('#error').textContent = message; $('#error').hidden = false; fitWindow(); };
const setBusy = (busy, label = ZI.t('info.busy')) => { $('#start').disabled = busy; $('#browser').disabled = busy; if (busy) $('#start').textContent = label; };

// The window is sized to its content, which grows when the networks card appears.
async function fitWindow() {
  try {
    const current = await chrome.windows.getCurrent();
    const chrome_ = window.outerHeight - window.innerHeight;
    const height = Math.min(Math.ceil(document.body.getBoundingClientRect().height) + chrome_, screen.availHeight - 40);
    if (Math.abs(height - window.outerHeight) > 4) await chrome.windows.update(current.id, { height });
  } catch {}
}

function render(data) {
  record = data;
  $('#title').textContent = data.filename || ZI.t('info.noName');
  drawTile(data.filename);
  let host = ''; try { host = new URL(data.url).hostname; } catch {}
  $('#host').textContent = host;
  $('#size').textContent = data.totalBytes > 0 ? bytes(data.totalBytes) : ZI.t('info.checking');
  $('#type').textContent = data.mime || ZI.t('info.checking');
  $('#source').textContent = data.url; $('#source').title = data.url;
  $('#start').disabled = false; $('#browser').disabled = false;
}

// Chrome often does not know the size or type yet (redirects, downloads that start late), so the app
// asks the server and fills them in.
async function probe() {
  try {
    const info = await send({ type: 'DOWNLOAD_INFO_PROBE', id });
    if (!info.ok) throw new Error(String(info.status || ''));
    $('#size').textContent = info.total > 0 ? bytes(info.total) : (record.totalBytes > 0 ? bytes(record.totalBytes) : ZI.t('info.unknown'));
    if (!record.mime || record.mime === 'application/octet-stream') $('#type').textContent = info.contentType || record.mime || ZI.t('info.generic');
    $('#resume').textContent = info.supportsRanges ? ZI.t('info.resumeYes') : ZI.t('info.resumeNo');
  } catch {
    if (!(record.totalBytes > 0)) $('#size').textContent = ZI.t('info.unknown');
    if (!record.mime) $('#type').textContent = ZI.t('info.generic');
    $('#resume').textContent = ZI.t('info.unknown');
  }
}

// With two or more connected networks the download can be split between them.
async function loadNetworks() {
  try {
    const info = await send({ type: 'DOWNLOAD_NETWORKS' });
    const usable = info.networks.filter(network => info.usable.includes(network.id));
    if (usable.length < 2 || info.proxy) return;
    networks = usable;
    $('#use-networks').checked = Boolean(info.enabled);
    $('#networks-note').textContent = ZI.t('info.networksNote', { n: usable.length });
    const list = $('#network-list'); list.replaceChildren();
    for (const network of usable) {
      const item = document.createElement('li'), dot = document.createElement('span'), name = document.createElement('span'), address = document.createElement('span');
      dot.className = 'dot'; name.className = 'name'; name.textContent = network.name; address.className = 'addr'; address.textContent = network.address;
      item.append(dot, name, address); list.append(item);
    }
    $('#networks').hidden = false; fitWindow();
  } catch {}
}

async function load() {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(ZI.t('info.badId'));
  render(await send({ type: 'DOWNLOAD_INFO', id }));
  fitWindow();
  await Promise.allSettled([probe(), loadNetworks()]);
  fitWindow();
}
$('#start').addEventListener('click', async () => {
  if (!record) return;
  setBusy(true, ZI.t('info.queueing')); $('#error').hidden = true;
  try { await send({ type: 'DOWNLOAD_INFO_START', id, ...(networks ? { multiNetwork: $('#use-networks').checked } : {}) }); window.close(); }
  catch (error) { showError(error.message); setBusy(false); $('#start').textContent = ZI.t('info.start'); }
});
$('#browser').addEventListener('click', async () => {
  if (!record) return;
  setBusy(true, ZI.t('info.continuing')); $('#error').hidden = true;
  try { await send({ type: 'DOWNLOAD_INFO_RESUME', id }); window.close(); }
  catch (error) { showError(error.message); setBusy(false); $('#start').textContent = ZI.t('info.start'); }
});
ZI.ready.then(() => { ZI.apply(); return load(); }).catch(error => { showError(error.message); $('#browser').disabled = false; });
