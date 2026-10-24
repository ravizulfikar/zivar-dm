// Text for the popup, the download info page, the video button and error messages.
// English is the default. The language follows the ZIVAR app: the background script stores it in
// chrome.storage.local ("language") whenever it talks to the app, and every page picks it up from there.
// Add new strings to BOTH dictionaries (tests/i18n.test.mjs fails when they differ).
(() => {
  const en = {
    'ext.noResponse': 'The extension did not respond.', 'ext.reloaded': 'The extension was updated. Reload the page, then try again.',
    'popup.openAppTitle': 'Open the ZIVAR app', 'popup.openApp': 'Open app', 'popup.checking': 'Checking connection…', 'popup.connected': 'Connected to the local app',
    'popup.connectTitle': 'Connect the local app', 'popup.connectHint': 'Open ZIVAR, click <b>Browser extension → Copy pairing code</b>, then paste it here.',
    'popup.pairingLabel': 'Pairing code', 'popup.pairingPlaceholder': 'Paste the pairing code', 'popup.connect': 'Connect', 'popup.paired': 'Connected successfully.',
    'popup.mediaTitle': 'Media in this tab', 'popup.refresh': 'Refresh', 'popup.empty': 'Play a video, then click <b>Download video</b> at the top right of the player. Detected media also appears here.',
    'popup.fromLink': 'Download from a link', 'popup.send': 'Send', 'popup.linkSent': 'Link sent to the app.',
    'popup.captureTitle': 'Show Chrome download info', 'popup.captureNote': 'Common files such as EXE, MSI, ZIP and documents are paused until you choose an action.',
    'popup.footer': 'Choose a quality from the button on the player. Supports MP4/WebM, HLS/DASH and YouTube. DRM-protected video is not supported.',
    'popup.download': 'Download with ZIVAR', 'popup.ad': 'Ad', 'popup.detected': 'Video detected', 'popup.codec': 'Codec {c}', 'popup.adSkip': 'Ad — not downloaded',
    'popup.ytNote': 'YouTube: choose a quality with the ZIVAR button on the player.', 'popup.streamNote': 'HLS/DASH stream: choose a quality with the ZIVAR button on the player.', 'popup.added': 'Video added to the app queue.',
    'info.eyebrow': 'New download detected', 'info.preparing': 'Preparing file information...', 'info.size': 'Size', 'info.type': 'Type', 'info.source': 'Source', 'info.checking': 'Checking...',
    'info.start': 'Start download', 'info.browser': 'Continue in Chrome', 'info.note': 'Start download adds the file to the ZIVAR queue. Chrome will not save it a second time.',
    'info.unknown': 'Unknown', 'info.busy': 'Working...', 'info.queueing': 'Adding to the queue...', 'info.continuing': 'Continuing in Chrome...', 'info.noName': 'Unnamed download', 'info.generic': 'Generic file', 'info.badId': 'Invalid download ID.',
    'ov.cannotStart': 'The download could not be started.', 'ov.detected': 'Video detected', 'ov.checking': 'Checking video...', 'ov.checkingAria': 'ZIVAR is checking the video',
    'ov.checkingTitle': 'ZIVAR is reading the available video qualities', 'ov.checkingMenu': 'ZIVAR is reading the available video qualities. Please wait...',
    'ov.drmPlayer': 'Encrypted/DRM video is not supported yet.', 'ov.drmVariants': 'This video is DRM-protected. ZIVAR cannot bypass its licensing system.',
    'ov.adPlaying': 'An ad is playing. Wait for the ad to finish and the main video to play, then try again.', 'ov.streamUnsupported': 'HLS/DASH streams are not supported. Choose a direct MP4/WebM video file.',
    'ov.noDirect': 'No direct video URL found yet. Play the video for a moment, then try again.', 'ov.unsupportedLabel': 'Video not supported', 'ov.pickQuality': 'Choose quality',
    'ov.download': 'Download video', 'ov.pickMedia': 'Choose video media', 'ov.infoAria': 'ZIVAR video support info', 'ov.downloadAria': 'Download video with ZIVAR', 'ov.pickMediaAria': 'Choose ZIVAR video media',
    'ov.sendTitle': 'Send this video to the ZIVAR app', 'ov.variants': 'Quality variants detected. Click a quality to merge video + audio into MP4.', 'ov.thisPlayer': 'Video for this player',
    'ov.pageMedia': 'Media detected on this page. Choose the right file.', 'ov.all': 'Download all ({n})', 'ov.drmFact': 'DRM — an official licence system is required', 'ov.hlsFact': 'HLS/DASH — not supported',
    'ov.sourceChanged': 'The video source changed. Click Download video again.', 'ov.sending': 'Sending...',
    'ov.browserOnly': 'This site only serves browsers, so the video is downloaded through Chrome. Keep Chrome open until it finishes.', 'ov.sent': 'Video sent to the ZIVAR queue.',
    'ov.manySent': '{n} video choices sent to the ZIVAR queue.', 'ov.partial': '{n} videos sent. {error}', 'ov.panelAria': 'ZIVAR download controls', 'ov.mediaChoices': 'Video media choices', 'ov.hide': 'Hide the ZIVAR button',
    'bg.badDownloadId': 'Invalid download ID.', 'bg.infoGone': 'The download info is no longer available.', 'bg.cannotResume': 'The Chrome download can no longer be continued.',
    'bg.pairFirst': 'Connect the extension with the pairing code from the local app.', 'bg.appOffline': 'The local app is not connected. Open ZIVAR first.', 'bg.appRefused': 'The app rejected the request.',
    'bg.badLink': 'The download link is invalid.', 'bg.appNoResponse': 'The local app did not respond while receiving data.', 'bg.appRefusedData': 'The app rejected the data.',
    'bg.order': 'The data order does not match. Click Resume in the app to try again.', 'bg.expired': 'The video server replied HTTP {status}. The link may have expired — choose "Refresh download address" in ZIVAR, then click Download again on the video page.',
    'bg.noRange': 'The server does not support resuming a download from the middle of the file.', 'bg.noData': 'The video server did not send data.', 'bg.dropped': 'The connection to the video server dropped. Click Resume to try again.',
    'bg.badHls': 'Invalid HLS playlist.', 'bg.pickOne': 'Choose one of the qualities, not the list of qualities.', 'bg.drm': 'This video is DRM-protected. ZIVAR cannot bypass its licensing system.',
    'bg.noSegments': 'The HLS playlist has no segments.', 'bg.menu': 'Download with ZIVAR', 'bg.linkSent': 'Link sent to ZIVAR.', 'bg.noMedia': 'Media not detected yet for this player. Reload the page and play the video.',
    'bg.drmMedia': 'This media is DRM-protected. ZIVAR cannot bypass its licensing system.', 'bg.streamUnsupported': 'Downloading HLS/DASH streams is not supported.', 'bg.sender': 'Sender not allowed.',
    'bg.badToken': 'The pairing code format is invalid.', 'bg.wrongPart': 'The server sent the wrong part of the file.', 'bg.unknown': 'Unrecognised message.',
  };
  const id = {
    'ext.noResponse': 'Ekstensi tidak merespons.', 'ext.reloaded': 'Ekstensi diperbarui. Muat ulang halaman, lalu coba kembali.',
    'popup.openAppTitle': 'Buka aplikasi ZIVAR', 'popup.openApp': 'Buka aplikasi', 'popup.checking': 'Memeriksa koneksi…', 'popup.connected': 'Terhubung ke aplikasi lokal',
    'popup.connectTitle': 'Hubungkan aplikasi lokal', 'popup.connectHint': 'Buka ZIVAR, klik <b>Ekstensi browser → Salin kode pairing</b>, lalu tempel di sini.',
    'popup.pairingLabel': 'Kode pairing', 'popup.pairingPlaceholder': 'Tempel kode pairing', 'popup.connect': 'Hubungkan', 'popup.paired': 'Berhasil terhubung.',
    'popup.mediaTitle': 'Media di tab ini', 'popup.refresh': 'Segarkan', 'popup.empty': 'Putar video, lalu klik <b>Unduh video</b> di pojok kanan atas pemutar. Media yang terdeteksi juga muncul di sini.',
    'popup.fromLink': 'Unduh dari tautan', 'popup.send': 'Kirim', 'popup.linkSent': 'Tautan dikirim ke aplikasi.',
    'popup.captureTitle': 'Tampilkan info download Chrome', 'popup.captureNote': 'File umum seperti EXE, MSI, ZIP, dan dokumen akan dijeda sampai Anda memilih aksi.',
    'popup.footer': 'Pilih kualitas langsung dari tombol di pemutar. Mendukung MP4/WebM, HLS/DASH, dan YouTube. Video DRM tidak didukung.',
    'popup.download': 'Unduh dengan ZIVAR', 'popup.ad': 'Iklan', 'popup.detected': 'Video terdeteksi', 'popup.codec': 'Codec {c}', 'popup.adSkip': 'Iklan — tidak diunduh',
    'popup.ytNote': 'YouTube: pilih kualitas lewat tombol ZIVAR di pemutar.', 'popup.streamNote': 'Stream HLS/DASH: pilih kualitas lewat tombol ZIVAR di pemutar.', 'popup.added': 'Video ditambahkan ke antrean aplikasi.',
    'info.eyebrow': 'Download baru terdeteksi', 'info.preparing': 'Menyiapkan informasi file...', 'info.size': 'Ukuran', 'info.type': 'Jenis', 'info.source': 'Sumber', 'info.checking': 'Memeriksa...',
    'info.start': 'Mulai download', 'info.browser': 'Lanjutkan di Chrome', 'info.note': 'Mulai download memasukkan file ke antrean ZIVAR. File tidak akan disimpan dua kali oleh Chrome.',
    'info.unknown': 'Tidak diketahui', 'info.busy': 'Memproses...', 'info.queueing': 'Memasukkan ke antrean...', 'info.continuing': 'Melanjutkan di Chrome...', 'info.noName': 'Download tanpa nama', 'info.generic': 'File umum', 'info.badId': 'ID download tidak valid.',
    'ov.cannotStart': 'Download tidak dapat dimulai.', 'ov.detected': 'Video terdeteksi', 'ov.checking': 'Memeriksa video...', 'ov.checkingAria': 'ZIVAR sedang memeriksa video',
    'ov.checkingTitle': 'ZIVAR sedang membaca kualitas video yang tersedia', 'ov.checkingMenu': 'ZIVAR sedang membaca kualitas video yang tersedia. Tunggu sebentar...',
    'ov.drmPlayer': 'Video terenkripsi/DRM belum didukung.', 'ov.drmVariants': 'Video ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.',
    'ov.adPlaying': 'Iklan sedang diputar. Tunggu iklan selesai sampai video utama berjalan, lalu coba kembali.', 'ov.streamUnsupported': 'Stream HLS/DASH belum didukung. Pilih file video MP4/WebM langsung.',
    'ov.noDirect': 'URL video langsung belum ditemukan. Putar videonya beberapa saat, lalu coba kembali.', 'ov.unsupportedLabel': 'Video belum didukung', 'ov.pickQuality': 'Pilih kualitas',
    'ov.download': 'Unduh video', 'ov.pickMedia': 'Pilih media video', 'ov.infoAria': 'Informasi dukungan video ZIVAR', 'ov.downloadAria': 'Unduh video dengan ZIVAR', 'ov.pickMediaAria': 'Pilih media video ZIVAR',
    'ov.sendTitle': 'Kirim video ini ke aplikasi ZIVAR', 'ov.variants': 'Varian kualitas terdeteksi. Klik kualitas untuk menggabungkan video + audio menjadi MP4.', 'ov.thisPlayer': 'Video untuk pemutar ini',
    'ov.pageMedia': 'Media terdeteksi di halaman ini. Pilih file yang sesuai.', 'ov.all': 'Unduh semua ({n})', 'ov.drmFact': 'DRM — sistem lisensi resmi diperlukan', 'ov.hlsFact': 'HLS/DASH — belum didukung',
    'ov.sourceChanged': 'Sumber video berubah. Klik Unduh video kembali.', 'ov.sending': 'Mengirim...',
    'ov.browserOnly': 'Situs ini hanya melayani browser, jadi video diunduh lewat Chrome. Biarkan Chrome tetap terbuka sampai selesai.', 'ov.sent': 'Video dikirim ke antrean ZIVAR.',
    'ov.manySent': '{n} pilihan video dikirim ke antrean ZIVAR.', 'ov.partial': '{n} video dikirim. {error}', 'ov.panelAria': 'Kontrol unduh ZIVAR', 'ov.mediaChoices': 'Pilihan media video', 'ov.hide': 'Sembunyikan tombol ZIVAR',
    'bg.badDownloadId': 'ID download tidak valid.', 'bg.infoGone': 'Info download sudah tidak tersedia.', 'bg.cannotResume': 'Download Chrome sudah tidak dapat dilanjutkan.',
    'bg.pairFirst': 'Hubungkan ekstensi dengan kode pairing dari aplikasi lokal.', 'bg.appOffline': 'Aplikasi lokal belum terhubung. Buka ZIVAR terlebih dahulu.', 'bg.appRefused': 'Aplikasi menolak permintaan.',
    'bg.badLink': 'Tautan download tidak valid.', 'bg.appNoResponse': 'Aplikasi lokal tidak merespons saat menerima data.', 'bg.appRefusedData': 'Aplikasi menolak data.',
    'bg.order': 'Urutan data tidak cocok. Klik Lanjut di aplikasi untuk mencoba lagi.', 'bg.expired': 'Server video membalas HTTP {status}. Tautan mungkin kedaluwarsa — pilih "Perbarui alamat unduhan" di ZIVAR, lalu klik Unduh lagi di halaman videonya.',
    'bg.noRange': 'Server tidak mendukung melanjutkan unduhan dari tengah file.', 'bg.noData': 'Server video tidak mengirim data.', 'bg.dropped': 'Koneksi ke server video terputus. Klik Lanjut untuk mencoba lagi.',
    'bg.badHls': 'Playlist HLS tidak valid.', 'bg.pickOne': 'Pilih salah satu kualitas, bukan daftar kualitasnya.', 'bg.drm': 'Video ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.',
    'bg.noSegments': 'Playlist HLS tidak berisi segmen.', 'bg.menu': 'Unduh dengan ZIVAR', 'bg.linkSent': 'Tautan dikirim ke ZIVAR.', 'bg.noMedia': 'Media belum terdeteksi untuk pemutar ini. Muat ulang halaman dan putar videonya.',
    'bg.drmMedia': 'Media ini dilindungi DRM. ZIVAR tidak dapat melewati sistem lisensinya.', 'bg.streamUnsupported': 'Pengunduhan stream HLS/DASH belum didukung.', 'bg.sender': 'Pengirim tidak diizinkan.',
    'bg.badToken': 'Format kode pairing tidak valid.', 'bg.wrongPart': 'Server mengirim bagian file yang salah.', 'bg.unknown': 'Pesan tidak dikenali.',
  };
  const dictionaries = { en, id };
  let language = 'en';
  const set = value => { if (dictionaries[value]) language = value; };
  const t = (key, params) => {
    const text = dictionaries[language][key] ?? en[key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : text;
  };
  const ready = (async () => { try { set((await chrome.storage.local.get('language')).language); } catch {} })();
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.language) { set(changes.language.newValue); globalThis.ZI?.onChange?.forEach(callback => callback()); } }); } catch {}
  function apply(root = document) {
    document.documentElement.lang = language;
    for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const element of root.querySelectorAll('[data-i18n-html]')) element.innerHTML = t(element.dataset.i18nHtml);
    for (const element of root.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
    for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
    for (const element of root.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', t(element.dataset.i18nAria));
  }
  globalThis.ZI = { t, set, apply, ready, onChange: [], dictionaries, get language() { return language; } };
})();
