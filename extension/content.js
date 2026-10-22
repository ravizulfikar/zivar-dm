(() => {
  // Same ad rules as background.js. Ad frames (IMA/VAST players) get no ZIVAR button at all.
  const adHosts = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|2mdn\.net|imasdk\.googleapis\.com|adsafeprotected\.com|springserve\.com|spotxchange\.com|spotx\.tv|innovid\.com|teads\.tv|tremorhub\.com|adnxs\.com|pubmatic\.com|moatads\.com|serving-sys\.com|flashtalking\.com|vidazoo\.com|aniview\.com|adform\.net|smartadserver\.com|unrulymedia\.com)$/i;
  const adPath = /(?:^|[/_.-])(?:ads?|adserver|adverts?|advertising|preroll|midroll|postroll|dclk_video_ads)(?:[/_.-]|$)/i;
  const isAd = value => { try { const url = new URL(value); return adHosts.test(url.hostname) || adPath.test(url.pathname); } catch { return false; } };
  if (isAd(location.href)) return;
  const panels = new Map();
  let scanTimer, refreshTimer, positionFrame, sourceSignature = '', reporting = Promise.resolve(), candidates = [], siteReason = null;
  // Until the first answer for this page arrives, show "checking" instead of "not supported".
  let checkedUrl = null, adsOnly = false;
  const checking = () => checkedUrl !== location.href;
  const http = url => /^https?:\/\//i.test(url || '');
  const sources = video => [...new Set([video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map(source => source.src)].filter(http))];
  const element = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  async function send(message) {
    try { return await chrome.runtime.sendMessage(message) || { ok: false, error: 'Ekstensi tidak merespons.' }; }
    catch { return { ok: false, error: 'Ekstensi diperbarui. Muat ulang halaman, lalu coba kembali.' }; }
  }
  const defaultBrowserDownloadTypes = [
    '3GP', '7Z', 'AAC', 'ACE', 'AIF', 'APK', 'ARJ', 'ASF', 'AVI', 'BIN', 'BZ2', 'EXE', 'GZ', 'GZIP', 'IMG', 'ISO',
    'LZH', 'M4A', 'M4V', 'MKV', 'MOV', 'MP3', 'MP4', 'MPA', 'MPE', 'MPEG', 'MPG', 'MSI', 'MSU', 'OGG', 'OGV', 'PDF',
    'PLJ', 'PPS', 'PPT', 'QT', 'R0*', 'R1*', 'RA', 'RAR', 'RM', 'RMVB', 'SEA', 'SIT', 'SITX', 'TAR', 'TIF', 'TIFF',
    'WAV', 'WMA', 'WMV', 'Z', 'ZIP',
  ];
  const defaultBrowserDownloadSiteExclusions = [
    '*.UPDATE.MICROSOFT.COM', 'DOWNLOAD.WINDOWSUPDATE.COM', '*.DOWNLOAD.WINDOWSUPDATE.COM', 'SITESEAL.THAWTE.COM',
    'ECOM.CIMETZ.COM', '*.VOICE2PAGE.COM',
  ];
  let browserLinkRules = { types: defaultBrowserDownloadTypes, siteExclusions: defaultBrowserDownloadSiteExclusions };
  function linkFilename(anchor, url) {
    const attribute = anchor.getAttribute('download');
    if (attribute) return String(attribute).split(/[\\/]/).pop().trim();
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; }
  }
  function linkExtension(value) {
    const clean = String(value || '').split(/[?#]/, 1)[0].replace(/[\\/]+$/, '');
    const name = clean.split(/[\\/]/).pop() || '';
    return /\.([A-Za-z0-9]{1,12})$/.exec(name)?.[1].toUpperCase() || '';
  }
  function linkSiteExcluded(url) {
    let hostname; try { hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return false; }
    return browserLinkRules.siteExclusions.some(pattern => {
      const value = String(pattern).toLowerCase();
      const wildcard = value.startsWith('*.');
      const base = wildcard ? value.slice(2) : value;
      return wildcard ? (hostname === base || hostname.endsWith(`.${base}`)) : hostname === base;
    });
  }
  function shouldCaptureLink(anchor, url) {
    if (linkSiteExcluded(url)) return false;
    const extension = linkExtension(linkFilename(anchor, url)) || linkExtension(url);
    return Boolean(anchor.hasAttribute('download') || extension && browserLinkRules.types.some(pattern => pattern.endsWith('*') ? extension.startsWith(pattern.slice(0, -1)) : extension === pattern));
  }
  function anchorFromEvent(event) {
    for (const node of event.composedPath?.() || []) {
      if (node instanceof HTMLAnchorElement && node.href) return node;
    }
    return event.target?.closest?.('a[href]') || null;
  }
  async function refreshBrowserLinkRules() {
    const result = await send({ type: 'BROWSER_DOWNLOAD_RULES' });
    if (result.ok && Array.isArray(result.types) && Array.isArray(result.siteExclusions)) browserLinkRules = result;
  }
  let lastCapturedLink = { key: '', time: 0 };
  function captureLinkEvent(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = anchorFromEvent(event); if (!anchor || anchor.target === '_self' && anchor.href.startsWith(`${location.origin}${location.pathname}#`)) return;
    let url; try { url = new URL(anchor.href, location.href).href; } catch { return; }
    if (!http(url) || url.startsWith(`${location.origin}${location.pathname}#`) || !shouldCaptureLink(anchor, url)) return;
    const key = `${url}\n${linkFilename(anchor, url)}`;
    const duplicate = lastCapturedLink.key === key && Date.now() - lastCapturedLink.time < 1500;
    lastCapturedLink = { key, time: Date.now() };
    event.preventDefault(); event.stopImmediatePropagation();
    if (duplicate) return;
    send({ type: 'BROWSER_LINK_DOWNLOAD', url, filename: linkFilename(anchor, url), referrer: location.href })
      .then(result => { if (!result.ok) toast(result.error); })
      .catch(error => toast(error.message || 'Download tidak dapat dimulai.'));
  }
  document.addEventListener('pointerdown', event => { if (event.isTrusted) captureLinkEvent(event); }, true);
  document.addEventListener('mousedown', event => { if (event.isTrusted) captureLinkEvent(event); }, true);
  document.addEventListener('click', captureLinkEvent, true);
  refreshBrowserLinkRules().catch(() => {});
  function toast(text) {
    const node = element('div', text);
    Object.assign(node.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', padding: '12px 16px 12px 14px', background: 'rgba(22,23,26,.96)', color: '#e6e8eb', border: '1px solid rgba(255,255,255,.14)', borderLeft: '4px solid #14b8a6', borderRadius: '10px', font: '13px "Segoe UI",system-ui,Arial,sans-serif', lineHeight: '1.45', maxWidth: '380px', boxShadow: '0 10px 30px rgba(0,0,0,.45)' });
    (document.fullscreenElement || document.documentElement).append(node); setTimeout(() => node.remove(), 5000);
  }
  function reportSources() {
    const items = [...document.querySelectorAll('video,audio')].flatMap(media => sources(media).filter(url => !isAd(url)).map(url => {
      const source = [...media.querySelectorAll('source')].find(item => item.src === url);
      const type = source?.type || media.getAttribute('type') || '';
      const codec = /codecs\s*=\s*["']([^"']+)["']/i.exec(type)?.[1] || '';
      return ({
      url, kind: media.localName, title: document.title,
      width: media.localName === 'video' ? media.videoWidth || null : null,
      height: media.localName === 'video' ? media.videoHeight || null : null,
      duration: Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null,
      codec: codec || null
    });
    }));
    const signature = JSON.stringify(items.map(item => [item.url, item.kind, item.width, item.height, item.duration, item.codec]));
    if (signature !== sourceSignature) { sourceSignature = signature; reporting = send({ type: 'MEDIA', items }); }
    return reporting;
  }
  function available(state) {
    const urls = sources(state.video);
    // A file that another <video> on the page is playing (e.g. an ad overlaid on the
    // main player) does not belong to this player.
    const others = new Set([...document.querySelectorAll('video')].filter(video => video !== state.video).flatMap(sources));
    const pool = candidates.filter(item => !item.ad && !isAd(item.url) && (urls.includes(item.url) || !others.has(item.url)));
    const exact = urls.length ? pool.filter(item => urls.includes(item.url)) : [];
    const direct = pool.filter(item => !item.stream && (item.kind === 'video' || /^video\//i.test(item.mime || '') || /\.(mp4|webm|m4v|mov)(?:[?#]|$)/i.test(item.url)));
    return exact.length ? [...new Map([...exact, ...direct].map(item => [item.url, item])).values()] : pool;
  }
  function describe(item) {
    let name = 'Video terdeteksi';
    try { const url = new URL(item.url); name = decodeURIComponent(url.pathname.split('/').pop()) || url.hostname; } catch {}
    return [name, item.manifestType || format(item), quality(item), bitrate(item), codec(item)].filter(Boolean).join(' · ');
  }
  function quality(item) {
    const match = /(?:^|[?&_/-])(?:quality|res|height)?[=_-]([1-9]\d{2,4})p?(?:[&#_/.-]|$)/i.exec(item.url);
    const value = Number(item.height) || Number(match?.[1]);
    return value ? `${value}p` : '';
  }
  function format(item) {
    if (item.manifestType === 'HLS') return 'HLS';
    if (item.manifestType === 'DASH') return 'DASH';
    const mime = String(item.mime || '').split(';')[0].toLowerCase();
    if (mime.includes('webm') || /\.webm(?:[?#]|$)/i.test(item.url)) return 'WebM';
    if (mime.includes('quicktime') || /\.(mov|m4v)(?:[?#]|$)/i.test(item.url)) return 'MOV';
    if (mime.includes('mp4') || /\.mp4(?:[?#]|$)/i.test(item.url)) return 'MP4';
    return mime.replace(/^video\//, '').toUpperCase() || 'VIDEO';
  }
  function duration(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
    const seconds = Math.round(Number(value)), minutes = Math.floor(seconds / 60);
    return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}j ` : ''}${minutes % 60}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function bitrate(item) {
    const value = Number(item.averageBandwidth || item.bandwidth || item.bitrate);
    if (!Number.isFinite(value) || value <= 0) return '';
    return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${Math.round(value / 1000)} kbps`;
  }
  function codec(item) {
    const value = String(item.codecs || item.codec || '').trim();
    return value ? `Codec ${value}` : '';
  }
  function size(item) {
    const value = Number(item.size);
    if (!Number.isFinite(value) || value <= 0) return '';
    const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
    const text = `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][index]}`;
    return `${item.sizeEstimated ? '~' : ''}${text}`;
  }
  function metadata(item, state) {
    const parts = [format(item), quality(item), bitrate(item), codec(item), size(item)];
    if (item.width && item.height) parts.push(`${item.width}x${item.height}`);
    const time = duration(item.duration || state.video.duration); if (time) parts.push(time);
    return parts.filter(Boolean).join(' · ');
  }
  function render(state) {
    if (!state.busy && checking()) {
      state.exact = null; state.reason = null; state.multiple = false;
      state.host.dataset.zivarState = 'checking';
      state.primary.dataset.checking = '';
      setLabel(state, 'Memeriksa video...');
      state.primary.setAttribute('aria-label', 'ZIVAR sedang memeriksa video');
      state.primary.title = 'ZIVAR sedang membaca kualitas video yang tersedia';
      state.menu.replaceChildren(element('p', 'ZIVAR sedang membaca kualitas video yang tersedia. Tunggu sebentar...'));
      return;
    }
    delete state.primary.dataset.checking;
    const items = available(state), urls = sources(state.video), direct = items.filter(item => !item.stream), variants = items.filter(item => item.stream && item.variant);
    state.exact = items.find(item => !item.stream && urls.includes(item.url));
    state.reason = siteReason || (state.encrypted || state.video.mediaKeys ? 'Video terenkripsi/DRM belum didukung.' : null);
    if (!state.reason && !items.some(item => !item.stream) && variants.length && variants.every(item => item.drm)) state.reason = 'Video ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.';
    if (!state.reason && !items.length && adsOnly) state.reason = 'Iklan sedang diputar. Tunggu iklan selesai sampai video utama berjalan, lalu coba kembali.';
    if (!state.reason && !items.some(item => !item.stream) && !variants.length) state.reason = items.some(item => item.stream) ? 'Stream HLS/DASH belum didukung. Pilih file video MP4/WebM langsung.' : 'URL video langsung belum ditemukan. Putar videonya beberapa saat, lalu coba kembali.';
    const ready = !state.reason && state.exact;
    state.multiple = !state.reason && (direct.length > 1 || variants.length > 1);
    state.host.dataset.zivarState = state.busy ? 'busy' : state.reason ? 'unsupported' : ready ? 'ready' : 'choose';
    if (!state.busy) setLabel(state, state.reason ? 'Video belum didukung' : state.multiple ? 'Pilih kualitas' : ready ? 'Unduh video' : 'Pilih media video');
    state.primary.setAttribute('aria-label', state.reason ? 'Informasi dukungan video ZIVAR' : ready ? 'Unduh video dengan ZIVAR' : 'Pilih media video ZIVAR');
    state.primary.title = state.reason || 'Kirim video ini ke aplikasi ZIVAR';
    state.menu.replaceChildren();
    if (state.reason) state.menu.append(element('p', state.reason));
    else {
      state.menu.append(element('p', variants.length ? 'Varian kualitas terdeteksi. Klik kualitas untuk menggabungkan video + audio menjadi MP4.' : state.exact ? 'Video untuk pemutar ini' : 'Media terdeteksi di halaman ini. Pilih file yang sesuai.'));
      if (direct.length > 1) {
        const all = element('button', `Unduh semua (${direct.length})`); all.className = 'media all'; all.addEventListener('click', event => { if (event.isTrusted) { event.stopPropagation(); downloadMany(state, direct); } }); state.menu.append(all);
      }
      // When quality variants exist, the raw manifest entry is just noise; show best quality first.
      const listed = variants.length ? [...direct, ...[...variants].sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0))] : items;
      for (const item of listed.slice(0, 10)) {
        const button = element('button'); button.className = 'media';
        button.disabled = Boolean(item.drm || item.stream && !item.variant);
        button.title = metadata(item, state);
        // Pill = quality; headline = format + size; then technical facts; then the file name, small.
        const hasQuality = Boolean(quality(item));
        const pill = element('span', quality(item) || format(item) || 'Video'); pill.className = `pill${hasQuality ? '' : ' muted'}`;
        let fileName = 'Video terdeteksi'; try { const url = new URL(item.url); fileName = decodeURIComponent(url.pathname.split('/').pop()) || url.hostname; } catch {}
        const headline = hasQuality ? [item.manifestType || format(item), size(item)].filter(Boolean).join(' · ') : fileName;
        const resolution = item.width && item.height ? `${item.width}x${item.height}` : '';
        const facts = item.drm ? 'DRM — sistem lisensi resmi diperlukan' : item.stream && !item.variant ? 'HLS/DASH — belum didukung'
          : [bitrate(item), resolution, duration(item.duration || state.video.duration), hasQuality ? '' : size(item), codec(item)].filter(Boolean).join(' · ') || [new URL(item.url).hostname, item.mime?.split(';')[0]].filter(Boolean).join(' · ');
        const text = element('span'); text.className = 'text';
        const title = element('span', headline); title.className = 'title';
        text.append(title, element('small', facts));
        if (hasQuality) { const file = element('small', fileName); file.className = 'file'; text.append(file); }
        button.append(pill, text); button.addEventListener('click', event => { if (!event.isTrusted) return; event.stopPropagation(); download(state, item); }); state.menu.append(button);
      }
    }
  }
  async function download(state, item) {
    if (state.busy || state.reason || item.drm || item.stream && !item.variant) return;
    if (state.encrypted || state.video.mediaKeys) { toast('Video terenkripsi/DRM belum didukung.'); return; }
    const current = sources(state.video);
    if (!item.variant && current.length && !current.includes(item.url)) { scheduleRefresh(); toast('Sumber video berubah. Klik Unduh video kembali.'); return; }
    state.busy = true; state.primary.disabled = true; state.host.dataset.zivarState = 'busy'; setLabel(state, 'Mengirim...'); state.menu.hidden = true; state.arrow.setAttribute('aria-expanded', 'false');
    try {
      const result = await send({ type: 'VIDEO_DOWNLOAD', url: item.url });
      if (!result.ok) throw new Error(result.error);
      toast(result.browser ? 'Situs ini hanya melayani browser, jadi video diunduh lewat Chrome. Biarkan Chrome tetap terbuka sampai selesai.' : 'Video dikirim ke antrean ZIVAR.');
    } catch (error) { toast(error.message); }
    finally { state.busy = false; state.primary.disabled = false; render(state); }
  }
  async function downloadMany(state, items) {
    if (state.busy || state.reason || !items.length) return;
    if (state.encrypted || state.video.mediaKeys) { toast('Video terenkripsi/DRM belum didukung.'); return; }
    state.busy = true; state.primary.disabled = true; state.host.dataset.zivarState = 'busy'; setLabel(state, 'Mengirim...'); state.menu.hidden = true; state.arrow.setAttribute('aria-expanded', 'false');
    let added = 0;
    try {
      for (const item of items) {
        const result = await send({ type: 'VIDEO_DOWNLOAD', url: item.url });
        if (!result.ok) throw new Error(result.error);
        added++;
      }
      toast(`${added} pilihan video dikirim ke antrean ZIVAR.`);
    } catch (error) { toast(added ? `${added} video dikirim. ${error.message}` : error.message); }
    finally { state.busy = false; state.primary.disabled = false; render(state); }
  }
  // Icons are built with DOM APIs (not innerHTML) so pages with Trusted Types (YouTube) accept them.
  function icon(className, ...paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  const PANEL_STYLE = [
    ':host([hidden]){display:none!important}',
    ':host{all:initial!important;position:fixed!important;left:var(--zivar-left,0px)!important;top:var(--zivar-top,0px)!important;z-index:2147483646!important;width:var(--zivar-width,204px)!important;font:12px "Segoe UI",system-ui,Arial,sans-serif!important;color:#e6e8eb!important;line-height:normal!important;pointer-events:auto!important}',
    '*{box-sizing:border-box}',
    'svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}',
    'button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;line-height:18px}',
    'button:focus-visible{outline:2px solid #2dd4bf;outline-offset:-2px}',
    '.bar{display:flex;align-items:stretch;height:36px;border-radius:10px;overflow:hidden;background:rgba(22,23,26,.92);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 22px rgba(0,0,0,.45);backdrop-filter:blur(8px)}',
    '.primary{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:0 10px 0 6px;font-weight:600;font-size:12px;text-align:left}',
    '.primary:hover:not(:disabled),.arrow:hover,.close:hover{background:rgba(255,255,255,.08)}',
    '.primary:disabled{cursor:default}',
    '.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.icon{position:relative;display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:#0f9e8e;color:#fff;flex:none;box-shadow:inset 0 -2px 0 rgba(0,0,0,.18)}',
    '.icon .alert{display:none}',
    ':host([data-zivar-state="unsupported"]) .icon{background:#b7791f}',
    ':host([data-zivar-state="unsupported"]) .icon .down{display:none}',
    ':host([data-zivar-state="unsupported"]) .icon .alert{display:block}',
    ':host([data-zivar-state="checking"]) .icon,:host([data-zivar-state="busy"]) .icon{background:#2b2e33}',
    ':host([data-zivar-state="checking"]) .icon svg,:host([data-zivar-state="busy"]) .icon svg{display:none!important}',
    ':host([data-zivar-state="checking"]) .icon::after,:host([data-zivar-state="busy"]) .icon::after{content:"";width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#2dd4bf;animation:zivar-spin .8s linear infinite}',
    ':host([data-zivar-state="checking"]) .label{font-weight:400;color:#b8bec6}',
    '@keyframes zivar-spin{to{transform:rotate(360deg)}}',
    '.arrow,.close{flex:0 0 30px;display:grid;place-items:center;border-left:1px solid rgba(255,255,255,.1);color:#b8bec6}',
    '.arrow[aria-expanded="true"] svg{transform:rotate(180deg)}',
    '.close svg{width:14px;height:14px}',
    '.menu{position:absolute;right:0;top:42px;width:300px;max-width:calc(100vw - 16px);overflow:auto;padding:6px;border-radius:12px;background:rgba(24,25,28,.97);border:1px solid rgba(255,255,255,.14);box-shadow:0 12px 36px rgba(0,0,0,.55);scrollbar-width:thin}',
    '.menu p{margin:0;padding:6px 8px 8px;font-size:11px;line-height:1.55;color:#9aa1aa;overflow-wrap:anywhere}',
    '.media{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border-radius:8px;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:12px}',
    '.media:hover:not(:disabled){background:rgba(45,212,191,.12)}',
    '.media:disabled{opacity:.5;cursor:default}',
    '.media .pill{flex:none;min-width:48px;padding:3px 6px;border-radius:6px;background:#0f9e8e;color:#fff;font-weight:700;font-size:11px;text-align:center}',
    '.media .pill.muted{background:#3a3d43;color:#cfd3d8}',
    '.media .text{min-width:0;display:grid;gap:2px}',
    '.media .title{font-weight:600;color:#eef0f2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.media small{display:block;color:#8d949d;font-size:10.5px;line-height:1.5}',
    '.media small.file{color:#646b74;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.media.all{justify-content:center;margin-bottom:4px;background:#0f9e8e;color:#fff;font-weight:600}',
    '.media.all:hover{background:#12b3a1!important}',
    '[hidden]{display:none!important}',
  ].join('');
  const setLabel = (state, text) => { state.label.textContent = text; };
  function createPanel(video) {
    const host = element('div'); host.dataset.zivarVideoPanel = ''; host.setAttribute('aria-label', 'Kontrol unduh ZIVAR');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = element('style'); style.textContent = PANEL_STYLE;
    const bar = element('div'); bar.className = 'bar';
    const badge = element('span'); badge.className = 'icon';
    badge.append(icon('down', 'M12 4.5v10', 'M7.5 10.5 12 15l4.5-4.5', 'M6 19h12'), icon('alert', 'M12 7v6.5', 'M12 17v.01'));
    const label = element('span', 'Unduh video'); label.className = 'label';
    const primary = element('button'); primary.className = 'primary'; primary.dataset.action = 'download'; primary.setAttribute('aria-label', 'Unduh video dengan ZIVAR'); primary.append(badge, label);
    const arrow = element('button'); arrow.className = 'arrow'; arrow.setAttribute('aria-label', 'Pilihan media video'); arrow.setAttribute('aria-expanded', 'false'); arrow.append(icon('', 'M7 10l5 5 5-5'));
    const close = element('button'); close.className = 'close'; close.setAttribute('aria-label', 'Sembunyikan tombol ZIVAR'); close.append(icon('', 'M7 7l10 10', 'M17 7 7 17'));
    const menu = element('div'); menu.className = 'menu'; menu.hidden = true;
    bar.append(primary, arrow, close); shadow.append(style, bar, menu);
    const state = { video, host, primary, label, menu, arrow, played: !video.paused && video.readyState > 0, dismissed: false, busy: false, encrypted: false, multiple: false };
    function toggle(event) { if (!event.isTrusted) return; event.stopPropagation(); menu.hidden = !menu.hidden; arrow.setAttribute('aria-expanded', String(!menu.hidden)); scheduleRefresh(); }
    primary.addEventListener('click', event => { if (!event.isTrusted) return; event.preventDefault(); event.stopPropagation(); if (!checking() && state.exact && !state.reason && !state.multiple) download(state, state.exact); else toggle(event); });
    arrow.addEventListener('click', toggle);
    close.addEventListener('click', event => { if (!event.isTrusted) return; event.stopPropagation(); state.dismissed = true; host.hidden = true; });
    host.addEventListener('click', event => event.stopPropagation());
    panels.set(video, state); resize.observe(video); render(state); return state;
  }
  const resize = new ResizeObserver(() => schedulePosition());
  function position() {
    positionFrame = null;
    for (const [video, state] of panels) {
      if (!video.isConnected) { state.host.remove(); resize.unobserve(video); panels.delete(video); continue; }
      const rect = video.getBoundingClientRect(), fullscreen = document.fullscreenElement;
      const visibleWidth = Math.min(innerWidth, rect.right) - Math.max(0, rect.left), visibleHeight = Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top);
      const computed = getComputedStyle(video);
      // No button on the ad player itself; the main player keeps its own button.
      const hidden = !state.played || state.dismissed || sources(video).some(isAd) || rect.width < 180 || rect.height < 90 || visibleWidth < 170 || visibleHeight < 70 || computed.visibility === 'hidden' || computed.display === 'none' || Number(computed.opacity) === 0 || document.pictureInPictureElement === video || fullscreen && (fullscreen === video || !fullscreen.contains(video));
      state.host.hidden = Boolean(hidden);
      if (hidden) continue;
      const parent = fullscreen || document.documentElement;
      if (state.host.parentElement !== parent) parent.append(state.host);
      const width = Math.min(214, visibleWidth - 16), left = Math.max(8, Math.min(rect.right - width - 8, innerWidth - width - 8));
      state.host.style.setProperty('--zivar-width', width + 'px', 'important');
      state.host.style.setProperty('--zivar-left', left + 'px', 'important');
      const top = Math.max(8, rect.top + 8); state.host.style.setProperty('--zivar-top', top + 'px', 'important');
      const menuWidth = Math.min(300, innerWidth - 16);
      state.menu.style.width = menuWidth + 'px'; state.menu.style.right = 'auto';
      state.menu.style.left = Math.max(8, Math.min(left + width - menuWidth, innerWidth - menuWidth - 8)) - left + 'px';
      state.menu.style.maxHeight = Math.max(80, Math.min(270, innerHeight - top - 48)) + 'px';
    }
  }
  function schedulePosition() { if (!positionFrame) positionFrame = requestAnimationFrame(position); }
  let candidatesUrl = null;
  async function refresh() {
    const page = location.href;
    // Single-page sites (YouTube) change video without reloading: drop the old list.
    if (candidatesUrl !== page) {
      candidatesUrl = page; candidates = []; siteReason = null;
      for (const state of panels.values()) render(state);
    }
    await reportSources();
    const result = await send({ type: 'VIDEO_CANDIDATES' });
    if (location.href !== page) return;
    candidates = result.ok ? result.items || [] : []; siteReason = result.ok ? result.reason || null : result.error;
    adsOnly = Boolean(result.ok && result.adsOnly);
    checkedUrl = page;
    for (const state of panels.values()) render(state);
    schedulePosition();
  }
  function scheduleRefresh() { if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 200); }
  function scan() {
    for (const video of document.querySelectorAll('video')) if (!panels.has(video)) createPanel(video);
    schedulePosition(); scheduleRefresh();
  }
  function later() { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 200); }
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  for (const type of ['play', 'playing', 'loadedmetadata', 'loadstart', 'encrypted', 'emptied']) document.addEventListener(type, event => {
    if (event.target.localName !== 'video') return;
    const state = panels.get(event.target) || createPanel(event.target);
    if (type === 'loadstart' || type === 'emptied') { state.played = false; state.dismissed = false; state.encrypted = false; state.menu.hidden = true; }
    else if (type === 'encrypted') state.encrypted = true;
    else if (type === 'play' || type === 'playing' || !event.target.paused) state.played = true;
    schedulePosition(); scheduleRefresh();
  }, true);
  document.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('fullscreenchange', schedulePosition);
  document.addEventListener('click', event => { for (const state of panels.values()) if (!event.composedPath().includes(state.host)) { state.menu.hidden = true; state.arrow.setAttribute('aria-expanded', 'false'); } });
  setInterval(() => { if (panels.size && document.visibilityState === 'visible') schedulePosition(); }, 500);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'SCAN') scan();
    if (message.type === 'MEDIA_UPDATED') scheduleRefresh();
    if (message.type === 'TOAST') toast(message.text);
  });
  scan();
})();


