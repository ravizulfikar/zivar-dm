const token = document.querySelector('meta[name="pairing-token"]').content;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const statuses = { queued: 'Antrean', downloading: 'Mengunduh', pausing: 'Menjeda…', paused: 'Dijeda', assembling: 'Menyatukan…', completed: 'Selesai', cancelling: 'Membatalkan…', cancelled: 'Dibatalkan', error: 'Gagal' };
const RUNNING = ['downloading', 'assembling', 'pausing'];
const PAUSABLE = ['queued', 'downloading', 'assembling'];
const RESUMABLE = ['paused', 'error'];
const CANCELLABLE = ['queued', 'downloading', 'assembling', 'paused', 'error'];
const CATEGORY_ICONS = ['video', 'audio', 'image', 'document', 'archive', 'program', 'other'];
let filter = 'all', state = null, toastTimer, polling = false, sort = { key: null, dir: 1 }, anchorId = null, query = '';
const speedSamples = [];
const AFTER_LABELS = { quit: 'Tutup ZIVAR', sleep: 'Sleep komputer', shutdown: 'Matikan komputer' };
const selection = new Set();
const rows = new Map();
const desktop = window.zivarDesktop?.isDesktop ? window.zivarDesktop : null;

// ---------- helpers ----------
function bytes(value) {
  if (value === null || value === undefined) return '—';
  if (!value) return '0 B';
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toLocaleString('id-ID', { maximumFractionDigits: index ? 2 : 0 })} ${['B', 'KB', 'MB', 'GB'][index]}`;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(url === '/api/youtube/formats' ? 200000 : 30000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Permintaan gagal.'); return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function svgUse(className, ...ids) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', className);
  for (const id of ids) { const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#${id}`); svg.append(use); }
  return svg;
}
function mediaTime(value) { if (!Number.isFinite(Number(value)) || Number(value) < 0) return '0:00'; const seconds = Math.floor(Number(value)); return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)} dtk`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} mnt ${Math.ceil(seconds % 60)} dtk`;
  return `${Math.floor(seconds / 3600)} jam ${Math.floor(seconds % 3600 / 60)} mnt`;
}
function when(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', ':') : ''; }
async function copyText(text) { if (desktop) await desktop.copyText(text); else await navigator.clipboard.writeText(text); }
const jobById = id => state?.jobs.find(job => job.id === id);
const selectedJobs = () => [...selection].map(jobById).filter(Boolean);

// ---------- row model ----------
function view(job, queueIndex) {
  const media = job.kind === 'media';
  const percent = job.status === 'completed' ? 100 : media && job.mediaDuration ? Math.min(100, 100 * (job.mediaPosition || 0) / job.mediaDuration) : job.total ? Math.min(100, 100 * job.received / job.total) : 0;
  let size;
  if (job.status === 'completed') size = bytes(media ? job.outputSize || job.mediaSize : job.total || job.received);
  else if (media) size = `${mediaTime(job.mediaPosition)} / ${mediaTime(job.mediaDuration)}`;
  else size = job.total ? `${bytes(job.received)} / ${job.totalEstimated ? '~' : ''}${bytes(job.total)}` : job.received ? bytes(job.received) : '—';
  const running = RUNNING.includes(job.status);
  const statusText = job.status === 'downloading' && (job.total || (media && job.mediaDuration)) ? `${percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : statuses[job.status] || job.status;
  const left = job.status === 'downloading' && !media && job.speed > 0 && job.total > job.received ? duration((job.total - job.received) / job.speed) : '';
  let host = ''; try { host = new URL(job.url).hostname; } catch {}
  const description = job.error || (job.kind === 'browser' ? `${host} · diunduh lewat Chrome` : job.kind === 'youtube' ? `${host} · YouTube` : media ? `${job.manifestType || 'Stream'} ${job.mediaWidth && job.mediaHeight ? `${job.mediaWidth}x${job.mediaHeight}` : ''}`.trim() : host);
  const tooltip = [description, job.outputPath].filter(Boolean).join('\n');
  return { tooltip, name: job.filename, category: CATEGORY_ICONS.includes(job.category) ? job.category : 'other', q: job.status === 'queued' ? String(queueIndex) : '', size, status: job.status, statusText, percent, running, left, rate: job.status === 'downloading' && job.speed > 0 ? `${bytes(job.speed)}/s` : '', last: when(job.completedAt || job.createdAt), description, error: Boolean(job.error) };
}
function createRow(job) {
  const tr = node('tr', 'job'); tr.dataset.id = job.id; tr.tabIndex = -1; tr.setAttribute('aria-selected', 'false');
  const name = node('td'); const nameBox = node('div', 'c-name'); name.append(nameBox);
  const status = node('td'); const wrap = node('div', 'status-wrap'); const progress = node('div', 'progress'); progress.append(node('span')); wrap.append(node('span', 'badge'), progress); status.append(wrap);
  tr.append(name, node('td', 'cell-q'), node('td', 'cell-size'), status, node('td', 'cell-left'), node('td', 'cell-rate'), node('td', 'cell-last'), node('td', 'cell-desc'));
  return { element: tr, signature: '' };
}
function updateRow(row, data) {
  const signature = JSON.stringify(data); if (row.signature === signature) return; row.signature = signature;
  const tr = row.element, cells = tr.children;
  const nameBox = cells[0].firstChild; nameBox.replaceChildren(svgUse(`ficon c-${data.category}`, 'f-sheet', `g-${data.category}`), node('span', '', data.name)); cells[0].title = data.name;
  cells[1].textContent = data.q; cells[2].textContent = data.size;
  const badge = cells[3].querySelector('.badge'); badge.className = `badge ${data.status}`; badge.textContent = data.statusText;
  cells[3].querySelector('.progress > span').style.width = `${data.percent}%`;
  tr.classList.toggle('running', data.running || data.status === 'paused' && data.percent > 0);
  cells[4].textContent = data.left; cells[5].textContent = data.rate; cells[6].textContent = data.last;
  cells[7].textContent = data.description; cells[7].title = data.tooltip; cells[0].title = [data.name, data.tooltip].join('\n'); cells[7].classList.toggle('error-text', data.error);
}

// ---------- rendering ----------
const searchable = job => { let host = ''; try { host = new URL(job.url).hostname; } catch {} return `${job.filename} ${host}`.toLowerCase(); };
const matches = job => (!query || query.split(/\s+/).every(word => searchable(job).includes(word))) && matchesFilter(job);
const matchesFilter = job => filter === 'all' || (filter === 'completed' ? job.status === 'completed' : filter === 'unfinished' ? !['completed', 'cancelled'].includes(job.status) : filter === 'queued' ? job.status === 'queued' : filter.startsWith('category:') ? (CATEGORY_ICONS.includes(job.category) ? job.category : 'other') === filter.slice(9) : false);
function sorted(list) {
  if (!sort.key) return list;
  const value = job => sort.key === 'name' ? job.filename.toLowerCase() : sort.key === 'size' ? (job.total || job.received || 0) : sort.key === 'status' ? job.status : sort.key === 'rate' ? (job.speed || 0) : Date.parse(job.completedAt || job.createdAt) || 0;
  return [...list].sort((a, b) => { const x = value(a), y = value(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
}
function render() {
  const { jobs } = state;
  const queueOrder = jobs.filter(job => job.status === 'queued').reverse().map(job => job.id);
  const totalSpeed = jobs.reduce((sum, job) => sum + (job.speed || 0), 0);
  $('#speed').textContent = `${bytes(totalSpeed)}/s`;
  drawSpeed(totalSpeed);
  const after = state.settings?.afterAll || 'none';
  $('#after-all-status').hidden = after === 'none'; $('#after-all-status').textContent = after === 'none' ? '' : `Setelah selesai: ${AFTER_LABELS[after]}`;
  for (const item of $$('[data-after]')) item.setAttribute('aria-checked', String(item.dataset.after === after));
  $('#active').textContent = jobs.filter(job => RUNNING.includes(job.status)).length;
  const count = (id, value) => { const element = $(`#count-${id}`); if (element) element.textContent = value; };
  count('all', jobs.length); count('completed', jobs.filter(job => job.status === 'completed').length);
  count('unfinished', jobs.filter(job => !['completed', 'cancelled'].includes(job.status)).length); count('queued', queueOrder.length);
  for (const category of CATEGORY_ICONS) count(category, jobs.filter(job => (CATEGORY_ICONS.includes(job.category) ? job.category : 'other') === category).length);
  $('#output-path').textContent = `Folder: ${state.downloadDirectory}`;
  if (state.version) { $('.version').textContent = `v${state.version}`; $('.version-text').textContent = `Versi ${state.version}`; }
  const connected = Boolean(state.browserIntegration?.connected);
  $('#setup-status').textContent = connected ? 'Ekstensi Chrome sudah terhubung dengan aplikasi.' : 'Belum ada koneksi ekstensi yang terdeteksi. Buka popup ekstensi dan klik Hubungkan.';
  $('#setup-status').classList.toggle('connected', connected);

  const shown = sorted(jobs.filter(matches)), container = $('#jobs'), visible = new Set(shown.map(job => job.id));
  for (const id of [...selection]) if (!visible.has(id)) selection.delete(id);
  for (const child of [...container.children]) if (!visible.has(child.dataset.id)) child.remove();
  for (const [index, job] of shown.entries()) {
    let row = rows.get(job.id);
    if (!row) { row = createRow(job); rows.set(job.id, row); }
    updateRow(row, view(job, queueOrder.indexOf(job.id) + 1));
    const selected = selection.has(job.id);
    row.element.classList.toggle('selected', selected); row.element.setAttribute('aria-selected', String(selected));
    // Rows are moved, never rebuilt, so selection and keyboard focus survive polling.
    if (container.children[index] !== row.element) container.insertBefore(row.element, container.children[index] || null);
  }
  for (const id of rows.keys()) if (!jobs.some(job => job.id === id)) rows.delete(id);
  $('#empty').hidden = shown.length > 0;
  $('#list-count').textContent = `${shown.length} item${selection.size ? ` · ${selection.size} dipilih` : ''}`;
  updateCommands();
}
// Speed graph: last 60 seconds of total speed, drawn as a small area chart.
function drawSpeed(value) {
  const now = Date.now();
  if (!speedSamples.length || now - speedSamples.at(-1).time >= 1000) { speedSamples.push({ time: now, value }); if (speedSamples.length > 60) speedSamples.shift(); }
  const canvas = $('#speed-graph'), context = canvas.getContext('2d'), ratio = window.devicePixelRatio || 1;
  if (canvas.width !== 120 * ratio) { canvas.width = 120 * ratio; canvas.height = 16 * ratio; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, 120, 16);
  const peak = Math.max(1, ...speedSamples.map(sample => sample.value));
  const x = index => 120 - (speedSamples.length - 1 - index) * 2, y = sample => 15 - (sample.value / peak) * 14;
  context.beginPath(); context.moveTo(x(0), 16);
  speedSamples.forEach((sample, index) => context.lineTo(x(index), y(sample)));
  context.lineTo(120, 16); context.closePath(); context.fillStyle = 'rgba(20,184,166,.28)'; context.fill();
  context.beginPath(); speedSamples.forEach((sample, index) => index ? context.lineTo(x(index), y(sample)) : context.moveTo(x(index), y(sample)));
  context.strokeStyle = '#14b8a6'; context.lineWidth = 1.2; context.stroke();
}
async function refresh() {
  if (polling) return; polling = true;
  try { state = await api('/api/state'); render(); $('#connection').textContent = 'Terhubung lokal'; $('#connection').classList.remove('offline'); }
  catch { $('#connection').textContent = 'Aplikasi terputus'; $('#connection').classList.add('offline'); }
  finally { polling = false; }
}

// ---------- selection ----------
function shownIds() { return [...$('#jobs').children].map(row => row.dataset.id); }
function select(id, { toggle = false, range = false } = {}) {
  const ids = shownIds();
  if (range && anchorId && ids.includes(anchorId)) {
    const [a, b] = [ids.indexOf(anchorId), ids.indexOf(id)].sort((x, y) => x - y);
    if (!toggle) selection.clear();
    for (const item of ids.slice(a, b + 1)) selection.add(item);
  } else if (toggle) { if (selection.has(id)) selection.delete(id); else selection.add(id); anchorId = id; }
  else { selection.clear(); selection.add(id); anchorId = id; }
  if (state) render();
  rows.get(id)?.element.focus({ preventScroll: false });
}
$('#jobs').addEventListener('mousedown', event => {
  const row = event.target.closest('tr[data-id]'); if (!row) return;
  if (event.button === 2 && selection.has(row.dataset.id)) return;
  select(row.dataset.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
});
$('#jobs').addEventListener('dblclick', event => { const row = event.target.closest('tr[data-id]'); if (row) defaultAction(jobById(row.dataset.id)); });
$('#table-wrap').addEventListener('mousedown', event => { if (!event.target.closest('tr[data-id]') && !event.target.closest('thead') && state) { selection.clear(); render(); } });
$('#table-wrap').addEventListener('keydown', event => {
  const ids = shownIds(); if (!ids.length) return;
  const current = ids.indexOf(anchorId);
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey) {
    event.preventDefault();
    const next = ids[Math.max(0, Math.min(ids.length - 1, current < 0 ? 0 : current + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (event.shiftKey) { const keep = anchorId; select(next, { range: true }); anchorId = keep; } else select(next);
  } else if (event.key === 'Delete') { event.preventDefault(); run('remove'); }
  else if (event.key === 'Enter') { event.preventDefault(); defaultAction(jobById(anchorId)); }
});
function defaultAction(job) {
  if (!job) return;
  if (job.status === 'completed') run('open-file');
  else if (RESUMABLE.includes(job.status)) run('resume');
}

// ---------- commands ----------
async function act(jobs, action) {
  let failed = 0;
  for (const job of jobs) { try { await api(`/api/downloads/${job.id}/${action}`, { method: 'POST' }); } catch { failed++; } }
  await refresh(); if (failed) toast(`${failed} unduhan tidak dapat diproses.`);
}
function ask(text, { title = 'Hapus dari daftar?', confirm = 'Hapus' } = {}) {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog'); $('#confirm-text').textContent = text;
    $('#confirm-title').textContent = title; $('#confirm-yes').textContent = confirm;
    const done = value => { dialog.close(); $('#confirm-yes').onclick = $('#confirm-no').onclick = dialog.oncancel = null; resolve(value); };
    $('#confirm-yes').onclick = () => done(true); $('#confirm-no').onclick = () => done(false); dialog.oncancel = event => { event.preventDefault(); done(false); };
    dialog.showModal(); $('#confirm-yes').focus();
  });
}
async function removeJobs(jobs, label) {
  if (!jobs.length) return;
  const running = jobs.some(job => !['completed', 'cancelled', 'error', 'paused'].includes(job.status));
  if (!await ask(`${label}${running ? ' Unduhan yang sedang berjalan akan dihentikan.' : ''} File yang sudah selesai tetap tersimpan di disk.`)) return;
  for (const job of jobs) selection.delete(job.id);
  await act(jobs, 'remove');
}
async function openSelected(show) {
  const job = selectedJobs().find(item => item.status === 'completed' && item.outputPath);
  if (!job) return toast('Pilih unduhan yang sudah selesai.');
  try {
    if (!desktop) { await api('/api/open-folder', { method: 'POST' }); return; }
    const result = await (show ? desktop.showFile(job.outputPath) : desktop.openFile(job.outputPath));
    if (result === 'shown') toast('File program tidak dijalankan otomatis. Lokasinya ditampilkan di Explorer.');
  } catch (error) { toast(error.message); }
}
function openSettings(schedule = false) {
  fillSettings(); $('#settings-dialog').showModal();
  $('#schedule-box').classList.toggle('highlight', schedule);
  if (schedule) $('#schedule-enabled').focus();
}
const commands = {
  add: () => { $('#form-error').textContent = ''; $('#add-dialog').showModal(); $('#url').focus(); },
  resume: () => act(selectedJobs().filter(job => RESUMABLE.includes(job.status)), 'resume'),
  pause: () => act(selectedJobs().filter(job => PAUSABLE.includes(job.status)), 'pause'),
  cancel: () => act(selectedJobs().filter(job => CANCELLABLE.includes(job.status)), 'cancel'),
  remove: () => { const jobs = selectedJobs(); return removeJobs(jobs, `Hapus ${jobs.length === 1 ? `"${jobs[0]?.filename}"` : `${jobs.length} unduhan`} dari daftar?`); },
  'resume-all': () => act(state.jobs.filter(job => RESUMABLE.includes(job.status)), 'resume'),
  'pause-all': () => act(state.jobs.filter(job => PAUSABLE.includes(job.status)), 'pause'),
  'remove-completed': () => { const jobs = state.jobs.filter(job => job.status === 'completed'); return removeJobs(jobs, `Hapus ${jobs.length} unduhan yang sudah selesai dari daftar?`); },
  'move-up': () => moveSelected('up'),
  'move-down': () => moveSelected('down'),
  'move-top': () => moveSelected('top'),
  'refresh-address': () => openRefresh(selectedJobs()[0]),
  checksum: () => openChecksum(selectedJobs().find(job => job.status === 'completed')),
  'open-file': () => openSelected(false),
  'show-file': () => openSelected(true),
  'copy-url': () => { const job = selectedJobs()[0]; if (job) copyText(job.url).then(() => toast('Alamat disalin.'), () => toast('Tidak dapat menyalin alamat.')); },
  'select-all': () => { for (const id of shownIds()) selection.add(id); render(); },
  folder: async () => { try { await api('/api/open-folder', { method: 'POST' }); } catch (error) { toast(error.message); } },
  settings: () => openSettings(false),
  scheduler: () => openSettings(true),
  grabber: () => $('#grabber-dialog').showModal(),
  setup: () => $('#setup-dialog').showModal(),
  about: () => { loadExtractor(); $('#update-box').hidden = true; $('#about-dialog').showModal(); },
  'check-update': () => checkForUpdate(),
  theme: () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'),
  sidebar: () => { document.body.classList.toggle('no-sidebar'); $('#sidebar-item').textContent = document.body.classList.contains('no-sidebar') ? 'Tampilkan kategori' : 'Sembunyikan kategori'; },
  quit: () => desktop?.quit(),
};
function run(name) { closeMenus(); if (!state && !['add', 'settings', 'scheduler', 'grabber', 'setup', 'about', 'theme', 'sidebar', 'quit', 'folder'].includes(name)) return; return commands[name]?.(); }
function updateCommands() {
  const jobs = selectedJobs(), all = state?.jobs || [];
  const enabled = {
    resume: jobs.some(job => RESUMABLE.includes(job.status)), pause: jobs.some(job => PAUSABLE.includes(job.status)), cancel: jobs.some(job => CANCELLABLE.includes(job.status)),
    remove: jobs.length > 0, 'open-file': jobs.some(job => job.status === 'completed'), 'show-file': jobs.some(job => job.status === 'completed'), 'copy-url': jobs.length > 0,
    'move-up': jobs.some(job => job.status === 'queued'), 'move-down': jobs.some(job => job.status === 'queued'), 'move-top': jobs.some(job => job.status === 'queued'),
    'refresh-address': jobs.length === 1 && jobs[0].status !== 'completed' && jobs[0].kind !== 'youtube',
    checksum: jobs.some(job => job.status === 'completed'),
    'resume-all': all.some(job => RESUMABLE.includes(job.status)), 'pause-all': all.some(job => PAUSABLE.includes(job.status)), 'remove-completed': all.some(job => job.status === 'completed'),
  };
  for (const element of $$('[data-command]')) if (element.dataset.command in enabled) element.disabled = !enabled[element.dataset.command];
}
document.addEventListener('click', event => {
  const item = event.target.closest('[data-command]');
  if (item && !item.disabled) { event.preventDefault(); run(item.dataset.command); }
});

// ---------- menus ----------
function closeMenus() {
  for (const trigger of $$('.menu-trigger')) { trigger.setAttribute('aria-expanded', 'false'); trigger.nextElementSibling.hidden = true; }
  $('#context-menu').hidden = true;
}
for (const trigger of $$('.menu-trigger')) {
  trigger.addEventListener('click', event => {
    event.stopPropagation(); const open = trigger.getAttribute('aria-expanded') === 'true';
    closeMenus(); if (!open) { updateCommands(); trigger.setAttribute('aria-expanded', 'true'); trigger.nextElementSibling.hidden = false; }
  });
  trigger.addEventListener('mouseenter', () => { if ($$('.menu-trigger').some(item => item !== trigger && item.getAttribute('aria-expanded') === 'true')) trigger.click(); });
}
document.addEventListener('mousedown', event => { if (!event.target.closest('.menu') && !event.target.closest('#context-menu')) closeMenus(); });
$('#jobs').addEventListener('contextmenu', event => {
  const row = event.target.closest('tr[data-id]'); if (!row) return;
  event.preventDefault(); if (!selection.has(row.dataset.id)) select(row.dataset.id);
  closeMenus(); updateCommands();
  const menu = $('#context-menu'); menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)}px`;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenus();
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Insert' || (event.ctrlKey && event.key.toLowerCase() === 'n')) { event.preventDefault(); run('add'); }
  if (event.ctrlKey && event.key.toLowerCase() === 'a' && !event.target.closest('input,select')) { event.preventDefault(); run('select-all'); }
});

// ---------- sidebar & sorting ----------
const filterNodes = $$('.tree [data-filter]');
function selectFilter(element) {
  filter = element.dataset.filter;
  for (const item of filterNodes) { item.classList.toggle('selected', item === element); item.tabIndex = item === element ? 0 : -1; }
  if (state) render();
}
for (const element of filterNodes) {
  element.addEventListener('click', event => {
    if (event.target.closest('.twisty')) return;
    selectFilter(element);
  });
  element.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); selectFilter(element);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = filterNodes.indexOf(element);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filterNodes.length - 1 : Math.max(0, Math.min(filterNodes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    filterNodes[next]?.focus();
  });
}
$('.twisty').addEventListener('click', event => { const item = event.target.closest('li'); item.setAttribute('aria-expanded', String(item.getAttribute('aria-expanded') !== 'true')); });
function sortBy(header) {
  sort = sort.key === header.dataset.sort ? (sort.dir === 1 ? { key: header.dataset.sort, dir: -1 } : { key: null, dir: 1 }) : { key: header.dataset.sort, dir: 1 };
  for (const item of $$('th[data-sort]')) item.setAttribute('aria-sort', item === header && sort.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  if (state) render();
}
for (const header of $$('th[data-sort]')) {
  header.tabIndex = 0;
  header.addEventListener('click', () => sortBy(header));
  header.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); sortBy(header);
  });
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme; $('#theme-item').textContent = theme === 'light' ? 'Tema gelap' : 'Tema terang';
  try { localStorage.setItem('zivar-theme', theme); } catch {}
}
try { setTheme(localStorage.getItem('zivar-theme') === 'light' ? 'light' : 'dark'); } catch { setTheme('dark'); }

// ---------- add dialog ----------
// Expands patterns like foto[001-120].jpg or bagian[a-f].zip (zero padding kept). Max 1000 links.
function expandPattern(line) {
  const match = /\[(\d+)-(\d+)\]|\[([a-z])-([a-z])\]/i.exec(line);
  if (!match) return [line];
  const [token] = match, out = [];
  if (match[1] !== undefined) {
    const from = Number(match[1]), to = Number(match[2]), width = match[1].length;
    if (to < from || to - from > 999) throw new Error(`Rentang ${token} terlalu besar atau terbalik.`);
    for (let n = from; n <= to; n++) out.push(...expandPattern(line.replace(token, String(n).padStart(width, '0'))));
  } else {
    const from = match[3].charCodeAt(0), to = match[4].charCodeAt(0);
    if (to < from) throw new Error(`Rentang ${token} terbalik.`);
    for (let c = from; c <= to; c++) out.push(...expandPattern(line.replace(token, String.fromCharCode(c))));
  }
  return out;
}
function batchLinks() {
  const links = $('#batch-urls').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(expandPattern);
  if (links.length > 1000) throw new Error(`Terlalu banyak tautan (${links.length}). Maksimal 1000 sekaligus.`);
  return links;
}
let batchMode = false, playlist = null;
function setAddMode(batch) {
  batchMode = batch;
  $('#tab-single').setAttribute('aria-selected', String(!batch)); $('#tab-batch').setAttribute('aria-selected', String(batch));
  $('#single-fields').hidden = batch; $('#batch-fields').hidden = !batch; $('#url').required = !batch;
  $('#youtube-box').hidden = batch; $('#form-error').textContent = '';
  updateBatchPreview();
}
function updateBatchPreview() {
  if (!batchMode) return;
  try { const count = batchLinks().length; $('#batch-preview').textContent = count ? `${count} tautan akan ditambahkan.` : ''; $('#add-button').textContent = count ? `Tambahkan ${count} unduhan` : 'Mulai unduh'; }
  catch (error) { $('#batch-preview').textContent = error.message; }
}
const youtubeLink = value => /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(value.trim());
const playlistLink = value => { try { const list = new URL(value.trim()).searchParams.get('list'); return Boolean(list && !/^RD/.test(list) && youtubeLink(value)); } catch { return false; } };
function resetYoutube(formats = []) {
  const select = $('#youtube-quality'); select.replaceChildren(new Option('Kualitas terbaik (MP4)', ''));
  const group = (label, options) => { const element = document.createElement('optgroup'); element.label = label; element.append(...options); select.append(element); };
  group('Batas resolusi', [2160, 1440, 1080, 720, 480, 360].map(height => new Option(`Maksimal ${height}p (MP4)`, `h${height}`)));
  group('Audio saja', [new Option('Audio M4A (kualitas asli)', 'audio-m4a'), new Option('Audio MP3', 'audio-mp3')]);
  if (formats.length) group('Format video ini', formats.map(f => new Option(`${f.height}p · ${f.codecs}${f.size ? ` · ${f.sizeEstimated ? '~' : ''}${bytes(f.size)}` : ''}`, f.formatId)));
}
function updateYoutubeBox() {
  const value = $('#url').value;
  $('#youtube-box').hidden = batchMode || !youtubeLink(value);
  const isList = playlistLink(value);
  $('#youtube-inspect').textContent = isList ? 'Baca playlist' : 'Baca kualitas';
  if (!isList) { playlist = null; $('#playlist-box').hidden = true; $('#playlist-all').checked = false; }
}
$('#tab-single').addEventListener('click', () => setAddMode(false));
$('#tab-batch').addEventListener('click', () => setAddMode(true));
$('#batch-urls').addEventListener('input', updateBatchPreview);
$('#add-cancel').addEventListener('click', () => $('#add-dialog').close());
$('#url').addEventListener('input', () => { resetYoutube(); updateYoutubeBox(); });
$('#add-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#add-button').disabled = true; $('#form-error').textContent = '';
  const subtitles = $('#youtube-subtitles').checked, format = $('#youtube-quality').value || null;
  try {
    if (batchMode || (playlist && $('#playlist-all').checked)) {
      // Specific format IDs belong to one video; a playlist uses the general presets.
      const preset = format && !/^(h\d+|audio-m4a|audio-mp3)$/.test(format) ? null : format;
      const items = batchMode ? batchLinks().map(url => ({ url })) : playlist.entries.map(entry => ({ url: entry.url, filename: entry.title, youtubeFormat: preset, youtubeSubtitles: subtitles }));
      if (!items.length) throw new Error('Masukkan minimal satu tautan.');
      const result = await api('/api/downloads/batch', { method: 'POST', body: JSON.stringify({ items }) });
      toast(`${result.added} unduhan ditambahkan${result.failed.length ? `, ${result.failed.length} gagal (${result.failed[0].error})` : ''}.`);
      $('#batch-urls').value = ''; updateBatchPreview();
    } else {
      const job = await api('/api/downloads', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim(), filename: $('#filename').value.trim(), youtubeFormat: format, youtubeSubtitles: subtitles }) });
      toast(job.refreshed ? 'Alamat unduhan diperbarui.' : 'Ditambahkan ke antrean unduhan.');
      selection.clear(); selection.add(job.id); anchorId = job.id;
    }
    $('#url').value = ''; $('#filename').value = ''; $('#youtube-subtitles').checked = false; resetYoutube(); updateYoutubeBox();
    $('#add-dialog').close(); await refresh();
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#add-button').disabled = false; if (!batchMode) $('#add-button').textContent = 'Mulai unduh'; }
});
$('#youtube-inspect').addEventListener('click', async () => {
  const button = $('#youtube-inspect'), label = button.textContent; button.disabled = true; button.textContent = 'Membaca...';
  try {
    if (playlistLink($('#url').value)) {
      playlist = await api('/api/youtube/playlist', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim() }) });
      $('#playlist-box').hidden = false; $('#playlist-all').checked = true;
      $('#playlist-info').textContent = `Playlist "${playlist.title}" berisi ${playlist.count} video. Setiap video masuk antrean sebagai unduhan terpisah dengan pilihan kualitas di atas.`;
    } else {
      const data = await api('/api/youtube/formats', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim() }) });
      const keep = $('#youtube-quality').value; resetYoutube(data.formats); $('#youtube-quality').value = keep;
      if (!$('#filename').value) $('#filename').value = data.title;
    }
    $('#form-error').textContent = '';
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = label; }
});
resetYoutube(); updateYoutubeBox();

// ---------- queue order, refresh address, checksum ----------
async function moveSelected(direction) {
  const queued = selectedJobs().filter(job => job.status === 'queued');
  // Keep the relative order of several selected rows while moving them.
  const order = direction === 'down' ? [...queued].reverse() : queued;
  for (const job of order) { try { await api(`/api/downloads/${job.id}/move`, { method: 'POST', body: JSON.stringify({ direction }) }); } catch (error) { toast(error.message); break; } }
  await refresh();
}
let refreshJob = null, refreshTimer = null;
async function openRefresh(job) {
  if (!job) return;
  try { await api(`/api/downloads/${job.id}/refresh`, { method: 'POST', body: '{}' }); }
  catch (error) { toast(error.message); return; }
  refreshJob = { id: job.id, since: job.refreshedAt || null };
  $('#refresh-file').textContent = job.filename; $('#refresh-old').textContent = job.url;
  $('#refresh-url').value = ''; $('#refresh-error').textContent = '';
  const until = Date.now() + 180_000;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    $('#refresh-countdown').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const current = jobById(refreshJob?.id);
    if (current && current.refreshedAt && current.refreshedAt !== refreshJob.since) { closeRefresh(false); toast(`Alamat diperbarui untuk ${current.filename}. Unduhan dilanjutkan.`); }
    else if (!left) { $('#refresh-error').textContent = 'Waktu tunggu habis. Tempel tautan baru, atau tutup lalu coba lagi.'; clearInterval(refreshTimer); }
  }, 500);
  $('#refresh-dialog').showModal(); $('#refresh-url').focus();
}
function closeRefresh(cancel = true) {
  clearInterval(refreshTimer); refreshJob = null;
  if (cancel) api('/api/refresh/cancel', { method: 'POST' }).catch(() => {});
  if ($('#refresh-dialog').open) $('#refresh-dialog').close();
}
$('#refresh-cancel').addEventListener('click', () => closeRefresh(true));
$('#refresh-dialog').addEventListener('cancel', event => { event.preventDefault(); closeRefresh(true); });
$('#refresh-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#refresh-error').textContent = '';
  try { await api(`/api/downloads/${refreshJob.id}/refresh`, { method: 'POST', body: JSON.stringify({ url: $('#refresh-url').value.trim() }) }); closeRefresh(false); toast('Alamat diperbarui. Unduhan dilanjutkan.'); await refresh(); }
  catch (error) { $('#refresh-error').textContent = error.message; }
});
let checksumJob = null;
function openChecksum(job) {
  if (!job) return;
  checksumJob = job; $('#checksum-file').textContent = job.filename;
  $('#checksum-result').value = ''; $('#checksum-expected').value = ''; $('#checksum-verdict').textContent = ''; $('#checksum-verdict').className = 'verdict';
  $('#checksum-dialog').showModal();
}
function compareChecksum() {
  const actual = $('#checksum-result').value.trim().toLowerCase(), expected = $('#checksum-expected').value.trim().toLowerCase().replace(/^(sha256|sha1|md5)[:=\s]+/, '');
  const verdict = $('#checksum-verdict');
  if (!actual || !expected) { verdict.textContent = ''; verdict.className = 'verdict'; return; }
  const ok = actual === expected; verdict.textContent = ok ? '✓ Cocok — file utuh dan sesuai.' : '✗ Tidak cocok — file mungkin rusak atau berbeda.'; verdict.className = `verdict ${ok ? 'ok' : 'bad'}`;
}
$('#checksum-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#checksum-run'); button.disabled = true; button.textContent = 'Menghitung…';
  try { const result = await api(`/api/downloads/${checksumJob.id}/checksum`, { method: 'POST', body: JSON.stringify({ algorithm: $('#checksum-algorithm').value }) }); $('#checksum-result').value = result.hash; compareChecksum(); }
  catch (error) { $('#checksum-verdict').textContent = error.message; $('#checksum-verdict').className = 'verdict bad'; }
  finally { button.disabled = false; button.textContent = 'Hitung'; }
});
$('#checksum-expected').addEventListener('input', compareChecksum);
$('#checksum-algorithm').addEventListener('change', () => { $('#checksum-result').value = ''; compareChecksum(); });
$('#checksum-copy').addEventListener('click', () => { if ($('#checksum-result').value) copyText($('#checksum-result').value).then(() => toast('Checksum disalin.')); });
$('#checksum-close').addEventListener('click', () => $('#checksum-dialog').close());

// ---------- search, "after all", keyboard ----------
$('#search').addEventListener('input', () => { query = $('#search').value.trim().toLowerCase(); if (state) render(); });
for (const item of $$('[data-after]')) item.addEventListener('click', async () => {
  closeMenus();
  try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ afterAll: item.dataset.after }) }); await refresh(); toast(item.dataset.after === 'none' ? 'Tidak ada tindakan setelah unduhan selesai.' : `Setelah semua unduhan selesai: ${AFTER_LABELS[item.dataset.after]}.`); }
  catch (error) { toast(error.message); }
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest('input,select,textarea')) return;
  if (event.ctrlKey && event.key === 'ArrowUp') { event.preventDefault(); run('move-up'); }
  if (event.ctrlKey && event.key === 'ArrowDown') { event.preventDefault(); run('move-down'); }
  if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search').focus(); }
});

// ---------- settings / grabber / about ----------
function localDateValue(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function isoDateValue(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
let system = { autoStart: false, activeProxy: '' };
function fillSettings() {
  const settings = state?.settings || { speedLimit: 0, categoryFolders: false, clipboardMonitor: false, schedule: { enabled: false, startAt: null, endAt: null } };
  $('#speed-limit').value = Math.round((settings.speedLimit || 0) / 1024);
  $('#concurrency').value = settings.concurrency || 3; $('#connections').value = settings.connections || 4;
  $('#category-folders').checked = Boolean(settings.categoryFolders); $('#clipboard-monitor').checked = Boolean(settings.clipboardMonitor);
  $('#notifications').checked = settings.notifications !== false; $('#after-all').value = settings.afterAll || 'none';
  $('#proxy').value = settings.proxy || ''; $('#auto-update-extractor').checked = settings.autoUpdateExtractor !== false;
  $('#schedule-enabled').checked = Boolean(settings.schedule?.enabled); $('#schedule-start').value = localDateValue(settings.schedule?.startAt); $('#schedule-end').value = localDateValue(settings.schedule?.endAt);
  $('#auto-start').checked = Boolean(system.autoStart);
  $('#proxy-note').textContent = system.activeProxy ? `Proxy aktif: ${system.activeProxy.replace(/\/\/[^@]*@/, '//•••@')}. Perubahan berlaku setelah ZIVAR dimulai ulang.` : 'Proxy dipakai untuk semua unduhan, YouTube, dan HLS/DASH. Perubahan berlaku setelah ZIVAR dimulai ulang.';
  loadExtractor();
}
async function loadExtractor() {
  try {
    const info = await api('/api/extractor');
    $('#update-extractor').disabled = !info.available || info.checking;
    $('#extractor-status').textContent = `Extractor yt-dlp ${info.version || '—'}${info.lastResult ? ` · ${info.lastResult}` : ''}${info.checking ? ' · memeriksa…' : ''}`;
    $('#about-extractor').textContent = `Extractor YouTube: yt-dlp ${info.version || '—'}`;
  } catch {}
}
$('#update-extractor').addEventListener('click', async () => {
  const button = $('#update-extractor'); button.disabled = true; $('#extractor-status').textContent = 'Memeriksa pembaruan extractor…';
  try { const info = await api('/api/extractor/update', { method: 'POST' }); toast(info.lastResult || 'Pemeriksaan selesai.'); } catch (error) { toast(error.message); }
  await loadExtractor();
});
$('#settings-cancel').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('#settings-status').textContent = '';
  try {
    const speed = Math.max(0, Number($('#speed-limit').value) || 0);
    const before = state?.settings?.proxy || '';
    const saved = await api('/api/settings', { method: 'POST', body: JSON.stringify({
      speedLimit: Math.floor(speed * 1024), concurrency: Number($('#concurrency').value), connections: Number($('#connections').value),
      categoryFolders: $('#category-folders').checked, clipboardMonitor: $('#clipboard-monitor').checked,
      notifications: $('#notifications').checked, afterAll: $('#after-all').value, proxy: $('#proxy').value.trim(), autoUpdateExtractor: $('#auto-update-extractor').checked,
      schedule: { enabled: $('#schedule-enabled').checked, startAt: isoDateValue($('#schedule-start').value), endAt: isoDateValue($('#schedule-end').value) },
    }) });
    if (desktop && $('#auto-start').checked !== Boolean(system.autoStart)) system.autoStart = await desktop.setAutoStart($('#auto-start').checked);
    $('#settings-dialog').close(); await refresh();
    if (saved.proxy !== before) {
      if (desktop && await ask('Proxy berubah. Mulai ulang ZIVAR sekarang agar proxy baru dipakai? Unduhan yang berjalan dijeda dan bisa dilanjutkan setelahnya.', { title: 'Mulai ulang ZIVAR?', confirm: 'Mulai ulang' })) await desktop.relaunch();
      else toast('Pengaturan disimpan. Proxy berlaku setelah ZIVAR dimulai ulang.');
    } else toast('Pengaturan disimpan.');
  } catch (error) { $('#settings-status').textContent = error.message; } finally { button.disabled = false; }
});
$('#grabber-cancel').addEventListener('click', () => $('#grabber-dialog').close());
$('#grabber-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#grabber-run'); button.disabled = true; $('#grabber-status').textContent = 'Memindai halaman...';
  try {
    const extensions = $('#grabber-types').value.split(',').map(value => value.trim()).filter(Boolean);
    const result = await api('/api/grabber', { method: 'POST', body: JSON.stringify({ url: $('#grabber-url').value.trim(), depth: Number($('#grabber-depth').value), maxFiles: Number($('#grabber-max').value), extensions }) });
    $('#grabber-status').textContent = `${result.pages} halaman dibaca, ${result.added} file masuk antrean, ${result.skipped} dilewati.`; toast(`${result.added} file ditambahkan dari Site Grabber.`); await refresh();
  } catch (error) { $('#grabber-status').textContent = error.message; } finally { button.disabled = false; }
});
$('#about-close').addEventListener('click', () => $('#about-dialog').close());
async function checkForUpdate() {
  loadExtractor();
  $('#update-box').hidden = false; $('#update-download').hidden = true; $('#update-notes').textContent = ''; $('#update-text').textContent = 'Memeriksa pembaruan…';
  if (!$('#about-dialog').open) $('#about-dialog').showModal();
  try {
    const info = await desktop.checkUpdate();
    if (!info.configured) $('#update-text').textContent = 'Alamat pembaruan belum diatur di build ini. Unduh versi baru secara manual dari tempat Anda mendapatkan ZIVAR.';
    else if (!info.available) $('#update-text').textContent = `ZIVAR ${info.current} sudah versi terbaru.`;
    else { $('#update-text').textContent = `Versi ${info.version} tersedia (Anda memakai ${info.current}).`; $('#update-notes').textContent = info.notes; $('#update-download').hidden = false; }
  } catch (error) { $('#update-text').textContent = error.message; }
}
$('#update-download').addEventListener('click', async () => {
  try { const job = await desktop.downloadUpdate(); $('#about-dialog').close(); selection.clear(); selection.add(job.id); await refresh(); toast('Installer pembaruan diunduh dan akan dicek checksum-nya. Setelah selesai, klik dua kali untuk memasang.'); }
  catch (error) { $('#update-text').textContent = error.message; }
});

// ---------- Chrome guide ----------
$('#copy-token').addEventListener('click', async () => { try { await copyText(token); toast('Kode pairing disalin. Tempel di ekstensi Chrome.'); } catch { toast('Tidak dapat menyalin kode pairing. Coba kembali.'); } });
$('#setup-copy-address').addEventListener('click', () => copyText('chrome://extensions').then(() => toast('Alamat disalin. Tempel di bilah alamat Chrome.')).catch(() => toast('Tidak dapat menyalin alamat.')));
$('#setup-copy-folder').addEventListener('click', () => copyText($('#extension-path').value).then(() => toast('Lokasi folder disalin.')).catch(() => toast('Tidak dapat menyalin lokasi folder.')));
$('#setup-check').addEventListener('click', refresh);
async function finishSetup() {
  try { if (desktop) await desktop.completeSetup(); $('#setup-dialog').close(); }
  catch (error) { toast(error.message); }
}
$('#setup-finish').addEventListener('click', finishSetup);
$('#setup-later').addEventListener('click', finishSetup);
$('#setup-dialog').addEventListener('cancel', event => { event.preventDefault(); finishSetup(); });
$('#open-extension-folder').addEventListener('click', () => {
  if (desktop) desktop.openExtensionFolder().catch(error => toast(error.message));
  else copyText($('#extension-path').value).then(() => toast('Lokasi folder disalin. Buka melalui File Explorer.')).catch(() => toast('Salin lokasi folder yang ditampilkan.'));
});

// ---------- start ----------
if (desktop) {
  document.body.classList.add('desktop');
  desktop.getSystem?.().then(info => { system = info; }).catch(() => {});
  $('#edition-label').textContent = 'Pengelola unduhan desktop';
  $('#quit-app').hidden = false; $('#quit-note').hidden = true;
  desktop.getInfo().then(info => {
    $('#extension-path').value = info.extensionDirectory;
    $('.version').textContent = `v${info.version}`; $('.version-text').textContent = `Versi ${info.version}`;
    if (info.showSetup) $('#setup-dialog').showModal();
  }).catch(error => toast(error.message));
}
updateCommands();
refresh(); setInterval(refresh, 1000);
