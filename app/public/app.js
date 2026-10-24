const token = document.querySelector('meta[name="pairing-token"]').content;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const { t, getLang, setLang, applyI18n, locale } = window.ZIVAR_I18N;
const RUNNING = ['downloading', 'assembling', 'pausing'];
const PAUSABLE = ['queued', 'downloading', 'assembling'];
const RESUMABLE = ['paused', 'error'];
const CANCELLABLE = ['queued', 'downloading', 'assembling', 'paused', 'error'];
const CATEGORY_ICONS = ['video', 'audio', 'image', 'document', 'archive', 'program', 'other'];
const SORT_DEFAULTS = { name: 1, size: -1, status: 1, rate: -1, last: -1 };
let filter = 'all', state = null, toastTimer, polling = false, sort = { key: null, dir: 1 }, anchorId = null, query = '';
let updateInfo = null;
const speedSamples = [];
const selection = new Set();
const rows = new Map();
const desktop = window.zivarDesktop?.isDesktop ? window.zivarDesktop : null;
const statusText = status => t(`status.${status}`);

// ---------- helpers ----------
function bytes(value) {
  if (value === null || value === undefined) return '—';
  if (!value) return '0 B';
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toLocaleString(locale(), { maximumFractionDigits: index ? 2 : 0 })} ${['B', 'KB', 'MB', 'GB'][index]}`;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(url === '/api/youtube/formats' ? 200000 : 30000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || t('err.request')); return data;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function svgUse(className, id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#${id}`); svg.append(use);
  return svg;
}
function mediaTime(value) { if (!Number.isFinite(Number(value)) || Number(value) < 0) return '0:00'; const seconds = Math.floor(Number(value)); return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return t('time.s', { n: Math.ceil(seconds) });
  if (seconds < 3600) return t('time.ms', { m: Math.floor(seconds / 60), s: Math.ceil(seconds % 60) });
  return t('time.hm', { h: Math.floor(seconds / 3600), m: Math.floor(seconds % 3600 / 60) });
}
function when(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
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
  else size = job.total ? `${bytes(job.received)} / ${job.totalEstimated ? '~' : ''}${bytes(job.total)}` : job.received ? bytes(job.received) : '';
  const running = RUNNING.includes(job.status);
  const label = job.status === 'downloading' && (job.total || (media && job.mediaDuration)) ? `${percent.toLocaleString(locale(), { maximumFractionDigits: 1 })}%` : statusText(job.status);
  const left = job.status === 'downloading' && !media && job.speed > 0 && job.total > job.received ? duration((job.total - job.received) / job.speed) : '';
  let host = ''; try { host = new URL(job.url).hostname; } catch {}
  const description = job.error || (job.kind === 'browser' ? t('job.viaChrome', { host }) : job.kind === 'youtube' ? `${host} · YouTube` : media ? `${job.manifestType || 'Stream'} ${job.mediaWidth && job.mediaHeight ? `${job.mediaWidth}x${job.mediaHeight}` : ''}`.trim() : host);
  const tooltip = [description, job.outputPath].filter(Boolean).join('\n');
  const primary = job.status === 'completed' ? 'open' : PAUSABLE.includes(job.status) ? 'pause' : RESUMABLE.includes(job.status) ? 'resume' : null;
  return { tooltip, name: job.filename, category: CATEGORY_ICONS.includes(job.category) ? job.category : 'other', q: job.status === 'queued' ? `#${queueIndex}` : '', size, status: job.status, label, percent, running, left, rate: job.status === 'downloading' && job.speed > 0 ? `${bytes(job.speed)}/s` : '', last: job.status === 'completed' ? when(job.completedAt || job.createdAt) : '', description, error: Boolean(job.error), primary, completed: job.status === 'completed', lang: getLang() };
}
const ACTION_ICONS = { pause: 'i-pause', resume: 'i-play', open: 'i-external' };
function createRow(job) {
  const element = node('div', 'job'); element.dataset.id = job.id; element.tabIndex = -1; element.setAttribute('role', 'option'); element.setAttribute('aria-selected', 'false');
  const icon = node('span', 'job-icon');
  const main = node('div', 'job-main'), title = node('div', 'job-title'), name = node('span', 'job-name'), badge = node('span', 'badge');
  title.append(name, badge);
  const meta = node('div', 'job-meta'), size = node('span', 'meta-size'), q = node('span', 'meta-q'), rate = node('span', 'meta-rate'), left = node('span', 'meta-left'), last = node('span', 'meta-last'), desc = node('span', 'meta-desc');
  meta.append(size, q, rate, left, last, desc);
  const progress = node('div', 'progress'), bar = node('span'); progress.append(bar);
  main.append(title, meta, progress);
  const actions = node('div', 'job-actions');
  const button = (kind, iconId, className = '') => { const b = node('button', className); b.type = 'button'; b.dataset.jobAction = kind; b.append(svgUse('', iconId)); return b; };
  const primary = button('primary', 'i-play', 'primary-action'), show = button('show', 'i-folder'), remove = button('remove', 'i-x'), more = button('more', 'i-more');
  actions.append(primary, show, remove, more);
  element.append(icon, main, actions);
  return { element, signature: '', refs: { icon, name, badge, size, q, rate, left, last, desc, bar, primary, show, remove, more, title } };
}
function updateRow(row, data) {
  const signature = JSON.stringify(data); if (row.signature === signature) return; row.signature = signature;
  const r = row.refs;
  r.icon.className = `job-icon c-${data.category}`; r.icon.replaceChildren(svgUse('', `t-${data.category}`));
  r.name.textContent = data.name; r.name.title = [data.name, data.tooltip].join('\n');
  r.badge.className = `badge ${data.status}`; r.badge.textContent = data.label;
  r.size.textContent = data.size; r.q.textContent = data.q; r.rate.textContent = data.rate;
  r.left.textContent = data.left ? t('job.left', { time: data.left }) : ''; r.last.textContent = data.last;
  r.desc.textContent = data.description; r.desc.title = data.tooltip; r.desc.classList.toggle('error-text', data.error);
  r.bar.style.width = `${data.percent}%`;
  row.element.classList.toggle('running', data.running || data.status === 'paused' && data.percent > 0);
  r.primary.hidden = !data.primary;
  if (data.primary) { r.primary.firstChild.firstChild.setAttribute('href', `#${ACTION_ICONS[data.primary]}`); r.primary.title = r.primary.ariaLabel = t(`act.${data.primary}`); }
  r.show.hidden = !data.completed; r.show.title = r.show.ariaLabel = t('ctx.show');
  r.remove.title = r.remove.ariaLabel = t('act.remove'); r.more.title = r.more.ariaLabel = t('menu.more');
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
const viewTitle = () => t(filter.startsWith('category:') ? `cat.${filter.slice(9)}` : `nav.${filter}`);
function render() {
  const { jobs } = state;
  const queueOrder = jobs.filter(job => job.status === 'queued').reverse().map(job => job.id);
  const totalSpeed = jobs.reduce((sum, job) => sum + (job.speed || 0), 0);
  $('#speed').textContent = `${bytes(totalSpeed)}/s`;
  drawSpeed(totalSpeed);
  const after = state.settings?.afterAll || 'none';
  $('#after-all-status').hidden = after === 'none'; $('#after-all-status').textContent = after === 'none' ? '' : t('after.chip', { action: t(`after.${after}`) });
  for (const item of $$('[data-after]')) item.setAttribute('aria-checked', String(item.dataset.after === after));
  const active = jobs.filter(job => RUNNING.includes(job.status)).length, completed = jobs.filter(job => job.status === 'completed').length;
  $('#active').textContent = active; $('#stat-queued').textContent = queueOrder.length; $('#stat-done').textContent = completed;
  const count = (id, value) => { const element = $(`#count-${id}`); if (element) element.textContent = value; };
  count('all', jobs.length); count('completed', completed);
  count('unfinished', jobs.filter(job => !['completed', 'cancelled'].includes(job.status)).length); count('queued', queueOrder.length);
  for (const category of CATEGORY_ICONS) count(category, jobs.filter(job => (CATEGORY_ICONS.includes(job.category) ? job.category : 'other') === category).length);
  $('#output-path').textContent = t('status.folder', { path: state.downloadDirectory });
  if (state.version) { for (const element of $$('.version')) element.textContent = `v${state.version}`; for (const element of $$('.version-text')) element.textContent = state.version; $('#about-version').textContent = `v${state.version}`; }
  const connected = Boolean(state.browserIntegration?.connected);
  $('#setup-status').textContent = connected ? t('setup.connected') : t('setup.notConnected');
  $('#setup-status').classList.toggle('connected', connected);
  $('#view-title').textContent = viewTitle();

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
  $('#list-count').textContent = `${t(shown.length === 1 ? 'list.one' : 'list.many', { n: shown.length })}${selection.size ? ` · ${t('list.selected', { n: selection.size })}` : ''}`;
  updateCommands();
}
// Speed graph: last 60 seconds of total speed, drawn as a small area chart behind the number.
function drawSpeed(value) {
  const now = Date.now();
  if (!speedSamples.length || now - speedSamples.at(-1).time >= 1000) { speedSamples.push({ time: now, value }); if (speedSamples.length > 60) speedSamples.shift(); }
  const canvas = $('#speed-graph'), context = canvas.getContext('2d'), ratio = window.devicePixelRatio || 1, width = 120, height = 28;
  if (canvas.width !== width * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  const peak = Math.max(1, ...speedSamples.map(sample => sample.value));
  const x = index => width - (speedSamples.length - 1 - index) * 2, y = sample => height - 2 - (sample.value / peak) * (height - 6);
  const gradient = context.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, 'rgba(25,198,180,.45)'); gradient.addColorStop(1, 'rgba(75,80,230,0)');
  context.beginPath(); context.moveTo(x(0), height);
  speedSamples.forEach((sample, index) => context.lineTo(x(index), y(sample)));
  context.lineTo(width, height); context.closePath(); context.fillStyle = gradient; context.fill();
  context.beginPath(); speedSamples.forEach((sample, index) => index ? context.lineTo(x(index), y(sample)) : context.moveTo(x(index), y(sample)));
  context.strokeStyle = '#19c6b4'; context.lineWidth = 1.5; context.stroke();
}
async function refresh() {
  if (polling) return; polling = true;
  try { state = await api('/api/state'); syncLanguage(); render(); $('#connection').textContent = t('status.connected'); $('#connection').classList.remove('offline'); }
  catch { $('#connection').textContent = t('status.disconnected'); $('#connection').classList.add('offline'); }
  finally { polling = false; }
  if (desktop?.updateState) pollUpdate();
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
  const row = event.target.closest('.job[data-id]'); if (!row) return;
  if (event.button === 2 && selection.has(row.dataset.id)) return;
  select(row.dataset.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
});
$('#jobs').addEventListener('click', event => {
  const button = event.target.closest('button[data-job-action]'); if (!button) return;
  const id = button.closest('.job').dataset.id, job = jobById(id); if (!job) return;
  if (!selection.has(id)) select(id);
  const action = button.dataset.jobAction;
  if (action === 'primary') defaultAction(job, true);
  else if (action === 'show') run('show-file');
  else if (action === 'remove') run('remove');
  else if (action === 'more') { const box = button.getBoundingClientRect(); openContextMenu(box.right, box.bottom); }
});
$('#jobs').addEventListener('dblclick', event => { if (event.target.closest('button')) return; const row = event.target.closest('.job[data-id]'); if (row) defaultAction(jobById(row.dataset.id)); });
$('#list-wrap').addEventListener('mousedown', event => { if (!event.target.closest('.job[data-id]') && state) { selection.clear(); render(); } });
$('#list-wrap').addEventListener('keydown', event => {
  const ids = shownIds(); if (!ids.length) return;
  const current = ids.indexOf(anchorId);
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.ctrlKey) {
    event.preventDefault();
    const next = ids[Math.max(0, Math.min(ids.length - 1, current < 0 ? 0 : current + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (event.shiftKey) { const keep = anchorId; select(next, { range: true }); anchorId = keep; } else select(next);
  } else if (event.key === 'Delete') { event.preventDefault(); run('remove'); }
  else if (event.key === 'Enter') { event.preventDefault(); defaultAction(jobById(anchorId)); }
});
function defaultAction(job, toggleRunning = false) {
  if (!job) return;
  if (job.status === 'completed') run('open-file');
  else if (RESUMABLE.includes(job.status)) run('resume');
  else if (toggleRunning && PAUSABLE.includes(job.status)) run('pause');
}

// ---------- commands ----------
async function act(jobs, action) {
  let failed = 0;
  for (const job of jobs) { try { await api(`/api/downloads/${job.id}/${action}`, { method: 'POST' }); } catch { failed++; } }
  await refresh(); if (failed) toast(t('toast.failed', { n: failed }));
}
function ask(text, { title = t('confirm.title'), confirm = t('confirm.remove') } = {}) {
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
  if (!await ask(`${label}${running ? ` ${t('confirm.running')}` : ''} ${t('confirm.keep')}`)) return;
  for (const job of jobs) selection.delete(job.id);
  await act(jobs, 'remove');
}
async function openSelected(show) {
  const job = selectedJobs().find(item => item.status === 'completed' && item.outputPath);
  if (!job) return toast(t('toast.pickCompleted'));
  try {
    if (!desktop) { await api('/api/open-folder', { method: 'POST' }); return; }
    const result = await (show ? desktop.showFile(job.outputPath) : desktop.openFile(job.outputPath));
    if (result === 'shown') toast(t('toast.programShown'));
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
  remove: () => { const jobs = selectedJobs(); return removeJobs(jobs, jobs.length === 1 ? t('confirm.one', { name: jobs[0]?.filename }) : t('confirm.many', { n: jobs.length })); },
  'resume-all': () => act(state.jobs.filter(job => RESUMABLE.includes(job.status)), 'resume'),
  'pause-all': () => act(state.jobs.filter(job => PAUSABLE.includes(job.status)), 'pause'),
  'remove-completed': () => { const jobs = state.jobs.filter(job => job.status === 'completed'); return removeJobs(jobs, t('confirm.completed', { n: jobs.length })); },
  'move-up': () => moveSelected('up'),
  'move-down': () => moveSelected('down'),
  'move-top': () => moveSelected('top'),
  'refresh-address': () => openRefresh(selectedJobs()[0]),
  checksum: () => openChecksum(selectedJobs().find(job => job.status === 'completed')),
  'open-file': () => openSelected(false),
  'show-file': () => openSelected(true),
  'copy-url': () => { const job = selectedJobs()[0]; if (job) copyText(job.url).then(() => toast(t('toast.copied')), () => toast(t('toast.copyFailed'))); },
  'select-all': () => { for (const id of shownIds()) selection.add(id); render(); },
  folder: async () => { try { await api('/api/open-folder', { method: 'POST' }); } catch (error) { toast(error.message); } },
  settings: () => openSettings(false),
  scheduler: () => openSettings(true),
  grabber: () => $('#grabber-dialog').showModal(),
  setup: () => $('#setup-dialog').showModal(),
  about: () => openAbout(),
  quit: () => desktop?.quit(),
};
function run(name) { closeMenus(); if (!state && !['add', 'settings', 'scheduler', 'grabber', 'setup', 'about', 'quit', 'folder'].includes(name)) return; return commands[name]?.(); }
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
}
document.addEventListener('mousedown', event => { if (!event.target.closest('.menu') && !event.target.closest('#context-menu')) closeMenus(); });
function openContextMenu(x, y) {
  closeMenus(); updateCommands();
  const menu = $('#context-menu'); menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
}
$('#jobs').addEventListener('contextmenu', event => {
  const row = event.target.closest('.job[data-id]'); if (!row) return;
  event.preventDefault(); if (!selection.has(row.dataset.id)) select(row.dataset.id);
  openContextMenu(event.clientX, event.clientY);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenus();
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Insert' || (event.ctrlKey && event.key.toLowerCase() === 'n')) { event.preventDefault(); run('add'); }
  if (event.ctrlKey && event.key.toLowerCase() === 'a' && !event.target.closest('input,select')) { event.preventDefault(); run('select-all'); }
});

// ---------- navigation, sorting, theme, language ----------
const filterNodes = $$('[data-filter]');
function selectFilter(element) {
  filter = element.dataset.filter;
  for (const item of filterNodes) item.classList.toggle('selected', item === element);
  if (state) render(); else $('#view-title').textContent = viewTitle();
}
for (const element of filterNodes) element.addEventListener('click', () => selectFilter(element));
$('#sort').addEventListener('change', () => { const key = $('#sort').value || null; sort = key ? { key, dir: SORT_DEFAULTS[key] } : { key: null, dir: 1 }; if (state) render(); });
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').firstChild.firstChild.setAttribute('href', theme === 'light' ? '#i-moon' : '#i-sun');
  try { localStorage.setItem('zivar-theme', theme); } catch {}
}
{
  let saved = null; try { saved = localStorage.getItem('zivar-theme'); } catch {}
  setTheme(saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
function applyLanguage() {
  applyI18n();
  for (const button of $$('#lang-switch [data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === getLang()));
  $('#edition-label').textContent = t(desktop ? 'status.desktop' : 'status.web');
  $('#view-title').textContent = viewTitle();
  resetYoutube(youtubeFormats); updateYoutubeBox(); updateBatchPreview();
  fillExtractorText();
  for (const row of rows.values()) row.signature = '';
  if (updateInfo) renderUpdate(); else renderUpdateIdle();
  if (state) render();
  $('#connection').textContent = state ? t('status.connected') : t('status.connecting');
}
let languageSynced = false;
function syncLanguage() {
  const serverLanguage = state?.settings?.language;
  if (!serverLanguage) return;
  let explicit = null; try { explicit = localStorage.getItem('zivar-lang'); } catch {}
  if (!languageSynced) {
    languageSynced = true;
    if (!explicit && serverLanguage !== getLang()) { setLang(serverLanguage, false); applyLanguage(); }
  }
  if (explicit && explicit === getLang() && serverLanguage !== explicit) api('/api/settings', { method: 'POST', body: JSON.stringify({ language: explicit }) }).catch(() => {});
}
for (const button of $$('#lang-switch [data-lang]')) button.addEventListener('click', () => {
  setLang(button.dataset.lang, true); applyLanguage();
  api('/api/settings', { method: 'POST', body: JSON.stringify({ language: button.dataset.lang }) }).catch(() => {});
});

// ---------- add dialog ----------
// Expands patterns like photo[001-120].jpg or part[a-f].zip (zero padding kept). Max 1000 links.
function expandPattern(line) {
  const match = /\[(\d+)-(\d+)\]|\[([a-z])-([a-z])\]/i.exec(line);
  if (!match) return [line];
  const [token] = match, out = [];
  if (match[1] !== undefined) {
    const from = Number(match[1]), to = Number(match[2]), width = match[1].length;
    if (to < from || to - from > 999) throw new Error(t('add.rangeBig', { token }));
    for (let n = from; n <= to; n++) out.push(...expandPattern(line.replace(token, String(n).padStart(width, '0'))));
  } else {
    const from = match[3].charCodeAt(0), to = match[4].charCodeAt(0);
    if (to < from) throw new Error(t('add.rangeReversed', { token }));
    for (let c = from; c <= to; c++) out.push(...expandPattern(line.replace(token, String.fromCharCode(c))));
  }
  return out;
}
function batchLinks() {
  const links = $('#batch-urls').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(expandPattern);
  if (links.length > 1000) throw new Error(t('add.tooMany', { n: links.length }));
  return links;
}
let batchMode = false, playlist = null, youtubeFormats = [];
function setAddMode(batch) {
  batchMode = batch;
  $('#tab-single').setAttribute('aria-selected', String(!batch)); $('#tab-batch').setAttribute('aria-selected', String(batch));
  $('#single-fields').hidden = batch; $('#batch-fields').hidden = !batch; $('#url').required = !batch;
  $('#youtube-box').hidden = batch; $('#form-error').textContent = '';
  updateBatchPreview();
}
function updateBatchPreview() {
  if (!batchMode) { $('#add-button').textContent = t('add.start'); return; }
  try { const count = batchLinks().length; $('#batch-preview').textContent = count ? t('add.willAdd', { n: count }) : ''; $('#add-button').textContent = count ? t('add.addN', { n: count }) : t('add.start'); }
  catch (error) { $('#batch-preview').textContent = error.message; }
}
const youtubeLink = value => /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(value.trim());
const playlistLink = value => { try { const list = new URL(value.trim()).searchParams.get('list'); return Boolean(list && !/^RD/.test(list) && youtubeLink(value)); } catch { return false; } };
function resetYoutube(formats = []) {
  youtubeFormats = formats;
  const select = $('#youtube-quality'), keep = select.value; select.replaceChildren(new Option(t('yt.best'), ''));
  const group = (label, options) => { const element = document.createElement('optgroup'); element.label = label; element.append(...options); select.append(element); };
  group(t('yt.limit'), [2160, 1440, 1080, 720, 480, 360].map(height => new Option(t('yt.max', { h: height }), `h${height}`)));
  group(t('yt.audioOnly'), [new Option(t('yt.m4a'), 'audio-m4a'), new Option(t('yt.mp3'), 'audio-mp3')]);
  if (formats.length) group(t('yt.thisVideo'), formats.map(f => new Option(`${f.height}p · ${f.codecs}${f.size ? ` · ${f.sizeEstimated ? '~' : ''}${bytes(f.size)}` : ''}`, f.formatId)));
  select.value = keep; if (select.value !== keep) select.value = '';
}
function updateYoutubeBox() {
  const value = $('#url').value;
  $('#youtube-box').hidden = batchMode || !youtubeLink(value);
  const isList = playlistLink(value);
  $('#youtube-inspect').textContent = isList ? t('yt.readList') : t('yt.read');
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
      if (!items.length) throw new Error(t('add.needOne'));
      const result = await api('/api/downloads/batch', { method: 'POST', body: JSON.stringify({ items }) });
      toast(`${t('add.added', { n: result.added })}${result.failed.length ? `, ${t('add.failedN', { n: result.failed.length, error: result.failed[0].error })}` : ''}.`);
      $('#batch-urls').value = ''; updateBatchPreview();
    } else {
      const job = await api('/api/downloads', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim(), filename: $('#filename').value.trim(), youtubeFormat: format, youtubeSubtitles: subtitles }) });
      toast(job.refreshed ? t('toast.refreshed') : t('toast.queued'));
      selection.clear(); selection.add(job.id); anchorId = job.id;
    }
    $('#url').value = ''; $('#filename').value = ''; $('#youtube-subtitles').checked = false; resetYoutube(); updateYoutubeBox();
    $('#add-dialog').close(); await refresh();
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { $('#add-button').disabled = false; if (!batchMode) $('#add-button').textContent = t('add.start'); }
});
$('#youtube-inspect').addEventListener('click', async () => {
  const button = $('#youtube-inspect'), label = button.textContent; button.disabled = true; button.textContent = t('yt.reading');
  try {
    if (playlistLink($('#url').value)) {
      playlist = await api('/api/youtube/playlist', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim() }) });
      $('#playlist-box').hidden = false; $('#playlist-all').checked = true;
      $('#playlist-info').textContent = t('yt.playlistInfo', { title: playlist.title, n: playlist.count });
    } else {
      const data = await api('/api/youtube/formats', { method: 'POST', body: JSON.stringify({ url: $('#url').value.trim() }) });
      resetYoutube(data.formats);
      if (!$('#filename').value) $('#filename').value = data.title;
    }
    $('#form-error').textContent = '';
  } catch (error) { $('#form-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = label; }
});

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
    if (current && current.refreshedAt && current.refreshedAt !== refreshJob.since) { closeRefresh(false); toast(t('refresh.done', { name: current.filename })); }
    else if (!left) { $('#refresh-error').textContent = t('refresh.timeout'); clearInterval(refreshTimer); }
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
  try { await api(`/api/downloads/${refreshJob.id}/refresh`, { method: 'POST', body: JSON.stringify({ url: $('#refresh-url').value.trim() }) }); closeRefresh(false); toast(t('refresh.updated')); await refresh(); }
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
  const ok = actual === expected; verdict.textContent = ok ? t('checksum.match') : t('checksum.mismatch'); verdict.className = `verdict ${ok ? 'ok' : 'bad'}`;
}
$('#checksum-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#checksum-run'); button.disabled = true; button.textContent = t('checksum.running');
  try { const result = await api(`/api/downloads/${checksumJob.id}/checksum`, { method: 'POST', body: JSON.stringify({ algorithm: $('#checksum-algorithm').value }) }); $('#checksum-result').value = result.hash; compareChecksum(); }
  catch (error) { $('#checksum-verdict').textContent = error.message; $('#checksum-verdict').className = 'verdict bad'; }
  finally { button.disabled = false; button.textContent = t('checksum.run'); }
});
$('#checksum-expected').addEventListener('input', compareChecksum);
$('#checksum-algorithm').addEventListener('change', () => { $('#checksum-result').value = ''; compareChecksum(); });
$('#checksum-copy').addEventListener('click', () => { if ($('#checksum-result').value) copyText($('#checksum-result').value).then(() => toast(t('checksum.copied'))); });
$('#checksum-close').addEventListener('click', () => $('#checksum-dialog').close());

// ---------- search, "after all", keyboard ----------
$('#search').addEventListener('input', () => { query = $('#search').value.trim().toLowerCase(); if (state) render(); });
for (const item of $$('[data-after]')) item.addEventListener('click', async () => {
  closeMenus();
  try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ afterAll: item.dataset.after }) }); await refresh(); toast(item.dataset.after === 'none' ? t('after.noneToast') : t('after.toast', { action: t(`after.${item.dataset.after}`) })); }
  catch (error) { toast(error.message); }
});
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || event.target.closest('input,select,textarea')) return;
  if (event.ctrlKey && event.key === 'ArrowUp') { event.preventDefault(); run('move-up'); }
  if (event.ctrlKey && event.key === 'ArrowDown') { event.preventDefault(); run('move-down'); }
  if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); $('#search').focus(); }
});

// ---------- settings / grabber ----------
function localDateValue(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function isoDateValue(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
let system = { autoStart: false, activeProxy: '' }, extractorInfo = null;
function fillSettings() {
  const settings = state?.settings || { speedLimit: 0, categoryFolders: false, clipboardMonitor: false, schedule: { enabled: false, startAt: null, endAt: null } };
  $('#speed-limit').value = Math.round((settings.speedLimit || 0) / 1024);
  $('#concurrency').value = settings.concurrency || 3; $('#connections').value = settings.connections || 4;
  $('#category-folders').checked = Boolean(settings.categoryFolders); $('#clipboard-monitor').checked = Boolean(settings.clipboardMonitor);
  $('#notifications').checked = settings.notifications !== false; $('#after-all').value = settings.afterAll || 'none';
  $('#proxy').value = settings.proxy || ''; $('#auto-update-extractor').checked = settings.autoUpdateExtractor !== false;
  $('#browser-download-types').value = Array.isArray(settings.browserDownloadTypes) ? settings.browserDownloadTypes.join(', ') : '';
  $('#browser-download-site-exclusions').value = Array.isArray(settings.browserDownloadSiteExclusions) ? settings.browserDownloadSiteExclusions.join('\n') : '';
  $('#schedule-enabled').checked = Boolean(settings.schedule?.enabled); $('#schedule-start').value = localDateValue(settings.schedule?.startAt); $('#schedule-end').value = localDateValue(settings.schedule?.endAt);
  $('#auto-start').checked = Boolean(system.autoStart);
  $('#proxy-note').textContent = system.activeProxy ? t('set.proxyActive', { proxy: system.activeProxy.replace(/\/\/[^@]*@/, '//•••@') }) : t('set.proxyNote');
  loadExtractor();
}
function fillExtractorText() {
  const info = extractorInfo; if (!info) { $('#extractor-status').textContent = t('set.extractorChecking'); return; }
  $('#update-extractor').disabled = !info.available || info.checking;
  $('#extractor-status').textContent = `${t('set.extractor', { v: info.version || '—' })}${info.lastResult ? ` · ${info.lastResult}` : ''}${info.checking ? ` · ${t('set.checking')}` : ''}`;
  $('#about-extractor').textContent = `yt-dlp ${info.version || '—'}`;
}
async function loadExtractor() { try { extractorInfo = await api('/api/extractor'); fillExtractorText(); } catch {} }
$('#update-extractor').addEventListener('click', async () => {
  const button = $('#update-extractor'); button.disabled = true; $('#extractor-status').textContent = t('set.extractorUpdating');
  try { const info = await api('/api/extractor/update', { method: 'POST' }); toast(info.lastResult || t('set.extractorDone')); } catch (error) { toast(error.message); }
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
      browserDownloadTypes: $('#browser-download-types').value,
      browserDownloadSiteExclusions: $('#browser-download-site-exclusions').value,
      schedule: { enabled: $('#schedule-enabled').checked, startAt: isoDateValue($('#schedule-start').value), endAt: isoDateValue($('#schedule-end').value) },
    }) });
    if (desktop && $('#auto-start').checked !== Boolean(system.autoStart)) system.autoStart = await desktop.setAutoStart($('#auto-start').checked);
    $('#settings-dialog').close(); await refresh();
    if (saved.proxy !== before) {
      if (desktop && await ask(t('set.restartAsk'), { title: t('set.restartTitle'), confirm: t('set.restartYes') })) await desktop.relaunch();
      else toast(t('set.savedProxy'));
    } else toast(t('set.saved'));
  } catch (error) { $('#settings-status').textContent = error.message; } finally { button.disabled = false; }
});
$('#grabber-cancel').addEventListener('click', () => $('#grabber-dialog').close());
$('#grabber-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#grabber-run'); button.disabled = true; $('#grabber-status').textContent = t('grab.scanning');
  try {
    const extensions = $('#grabber-types').value.split(',').map(value => value.trim()).filter(Boolean);
    const result = await api('/api/grabber', { method: 'POST', body: JSON.stringify({ url: $('#grabber-url').value.trim(), depth: Number($('#grabber-depth').value), maxFiles: Number($('#grabber-max').value), extensions }) });
    $('#grabber-status').textContent = t('grab.result', { pages: result.pages, added: result.added, skipped: result.skipped }); toast(t('grab.toast', { n: result.added })); await refresh();
  } catch (error) { $('#grabber-status').textContent = error.message; } finally { button.disabled = false; }
});

// ---------- About and updates ----------
// The desktop app owns the update state machine (check → download → verify → install);
// this page only shows it. Phases: idle, checking, uptodate, available, downloading, ready, error.
function renderUpdateIdle() {
  $('#update-state').textContent = ''; $('#update-state').className = 'update-state';
  $('#update-text').textContent = desktop ? t('update.idle') : t('update.webOnly');
  $('#update-check').hidden = !desktop; $('#update-download').hidden = true; $('#update-install').hidden = true; $('#update-progress').hidden = true; $('#update-notes').textContent = '';
}
function renderUpdate() {
  const info = updateInfo; if (!info) return renderUpdateIdle();
  const phase = info.phase;
  $('#update-dot').hidden = !['available', 'downloading', 'ready'].includes(phase);
  const label = { checking: 'update.checking', uptodate: 'update.upToDateShort', available: 'update.availableShort', downloading: 'update.downloadingShort', ready: 'update.readyShort', error: 'update.errorShort' }[phase];
  $('#update-state').textContent = label ? t(label) : ''; $('#update-state').className = `update-state ${phase}`;
  $('#update-notes').textContent = ['available', 'downloading', 'ready'].includes(phase) ? info.notes || '' : '';
  let text = '';
  if (phase === 'checking') text = t('update.checkingText');
  else if (phase === 'unconfigured') text = t('update.unconfigured');
  else if (phase === 'uptodate') text = t('update.upToDate', { v: info.current });
  else if (phase === 'available') text = t('update.available', { v: info.version, current: info.current });
  else if (phase === 'downloading') text = t('update.downloading', { v: info.version, p: Math.round(info.progress || 0) });
  else if (phase === 'ready') text = t(info.installKind === 'portable' ? 'update.readyPortable' : info.installKind === 'dmg' ? 'update.readyDmg' : info.installKind === 'package' ? 'update.readyPackage' : 'update.ready', { v: info.version });
  else if (phase === 'error') text = info.error || t('update.error');
  else if (phase === 'unsupported') text = t('update.unsupported');
  else text = t('update.idle');
  $('#update-text').textContent = text;
  const busy = ['checking', 'downloading'].includes(phase);
  $('#update-check').hidden = !desktop || ['available', 'downloading', 'ready'].includes(phase); $('#update-check').disabled = busy;
  $('#update-download').hidden = phase !== 'available'; $('#update-install').hidden = phase !== 'ready';
  $('#update-progress').hidden = phase !== 'downloading'; $('#update-progress > span').style.width = `${info.progress || 0}%`;
}
let lastUpdateSignature = '';
async function pollUpdate() {
  try {
    const info = await desktop.updateState(); const signature = JSON.stringify(info);
    if (signature === lastUpdateSignature) return; lastUpdateSignature = signature; updateInfo = info; renderUpdate();
  } catch {}
}
async function openAbout() {
  loadExtractor();
  if (desktop) { try { updateInfo = await desktop.updateState(); } catch {} }
  $('#auto-update').checked = state?.settings?.autoUpdate !== false; $('#auto-update').closest('label').hidden = !desktop;
  renderUpdate(); fillExtractorText();
  $('#about-dialog').showModal();
}
async function updateAction(call) {
  try { updateInfo = await call(); lastUpdateSignature = JSON.stringify(updateInfo); renderUpdate(); }
  catch (error) { updateInfo = { phase: 'error', error: error.message }; renderUpdate(); }
}
$('#update-check').addEventListener('click', () => { updateInfo = { phase: 'checking' }; renderUpdate(); updateAction(() => desktop.checkUpdate()); });
$('#update-download').addEventListener('click', () => updateAction(() => desktop.downloadUpdate()));
$('#update-install').addEventListener('click', () => updateAction(() => desktop.installUpdate()));
$('#auto-update').addEventListener('change', () => api('/api/settings', { method: 'POST', body: JSON.stringify({ autoUpdate: $('#auto-update').checked }) }).then(refresh).catch(error => toast(error.message)));
$('#about-close').addEventListener('click', () => $('#about-dialog').close());
$('#about-site').addEventListener('click', event => { if (desktop?.openExternal) { event.preventDefault(); desktop.openExternal(event.currentTarget.href).catch(error => toast(error.message)); } });

// ---------- Browser extension guide ----------
$('#copy-token').addEventListener('click', async () => { try { await copyText(token); toast(t('setup.codeCopied')); } catch { toast(t('setup.codeFailed')); } });
$('#setup-copy-address').addEventListener('click', () => copyText('chrome://extensions').then(() => toast(t('setup.addrCopied'))).catch(() => toast(t('toast.copyFailed'))));
$('#setup-copy-folder').addEventListener('click', () => copyText($('#extension-path').value).then(() => toast(t('setup.folderCopied'))).catch(() => toast(t('setup.folderFailed'))));
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
  else copyText($('#extension-path').value).then(() => toast(t('setup.folderCopiedWeb'))).catch(() => toast(t('setup.folderManual')));
});

// ---------- start ----------
function platformName(info) {
  const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  return `${names[info.platform] || info.platform} (${info.arch})`;
}
if (desktop) {
  document.body.classList.add('desktop');
  desktop.getSystem?.().then(info => { system = info; }).catch(() => {});
  $('#quit-app').hidden = false; $('#quit-note').hidden = true;
  desktop.getInfo().then(info => {
    $('#extension-path').value = info.extensionDirectory;
    for (const element of $$('.version')) element.textContent = `v${info.version}`; for (const element of $$('.version-text')) element.textContent = info.version; $('#about-version').textContent = `v${info.version}`;
    $('#about-platform').textContent = platformName(info);
    $('#about-engine').textContent = `Electron ${info.versions.electron} · Chromium ${info.versions.chrome.split('.')[0]} · Node ${info.versions.node}`;
    if (info.showSetup) $('#setup-dialog').showModal();
  }).catch(error => toast(error.message));
} else {
  $('#about-platform').textContent = navigator.userAgentData?.platform || ({ Win: 'Windows', Mac: 'macOS', Linux: 'Linux', Android: 'Android' }[/(Win|Mac|Linux|Android)/.exec(navigator.userAgent)?.[1]] || 'Web');
  $('#about-engine').textContent = navigator.userAgent.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/)?.[0].replace('/', ' ') || 'Web';
  $('#extension-path').value = '';
}
applyLanguage();
updateCommands();
refresh(); setInterval(refresh, 1000);
