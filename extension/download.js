const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const id = Number(params.get('id'));
let record = null;
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
const showError = message => { $('#error').textContent = message; $('#error').hidden = false; };
const setBusy = (busy, label = ZI.t('info.busy')) => { $('#start').disabled = busy; $('#browser').disabled = busy; if (busy) $('#start').textContent = label; };
function render(data) {
  record = data;
  $('#title').textContent = data.filename || ZI.t('info.noName');
  $('#size').textContent = data.totalBytes > 0 ? bytes(data.totalBytes) : ZI.t('info.unknown');
  $('#type').textContent = data.mime || ZI.t('info.generic');
  $('#source').textContent = data.url;
  $('#source').title = data.url;
  $('#start').disabled = false; $('#browser').disabled = false;
}
async function load() {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(ZI.t('info.badId'));
  render(await send({ type: 'DOWNLOAD_INFO', id }));
}
$('#start').addEventListener('click', async () => {
  if (!record) return;
  setBusy(true, ZI.t('info.queueing')); $('#error').hidden = true;
  try { await send({ type: 'DOWNLOAD_INFO_START', id }); window.close(); }
  catch (error) { showError(error.message); setBusy(false); $('#start').textContent = ZI.t('info.start'); }
});
$('#browser').addEventListener('click', async () => {
  if (!record) return;
  setBusy(true, ZI.t('info.continuing')); $('#error').hidden = true;
  try { await send({ type: 'DOWNLOAD_INFO_RESUME', id }); window.close(); }
  catch (error) { showError(error.message); setBusy(false); $('#start').textContent = ZI.t('info.start'); }
});
ZI.ready.then(() => { ZI.apply(); return load(); }).catch(error => { showError(error.message); $('#browser').disabled = false; });
