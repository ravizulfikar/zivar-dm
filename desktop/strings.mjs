// Text shown by the desktop shell itself (tray, notifications, native dialogs).
// The language follows the interface language stored in the app settings.
const dictionaries = {
  en: {
    'tray.open': 'Open ZIVAR', 'tray.folder': 'Download folder', 'tray.extension': 'Browser extension folder', 'tray.quit': 'Quit',
    'tray.notice.title': 'ZIVAR is still running', 'tray.notice.body': 'Downloads continue in the background. Open the ZIVAR tray icon to return or quit.',
    'notify.done': 'Download complete', 'notify.failed': 'Download failed', 'notify.retry': 'Click Resume to try again.',
    'notify.updateAvailable': 'ZIVAR update available', 'notify.updateAvailableBody': 'Version {v} is ready to download. Open About → Check for updates.',
    'notify.updateReady': 'ZIVAR update ready', 'notify.updateReadyBody': 'Version {v} is downloaded and verified. Open About to install it.',
    'after.quit': 'close ZIVAR', 'after.sleep': 'put the computer to sleep', 'after.shutdown': 'shut down the computer',
    'after.title': 'All downloads finished', 'after.message': 'ZIVAR will {action} in 60 seconds.', 'after.detail': 'Click Cancel to stop it.', 'after.cancel': 'Cancel', 'after.now': 'Do it now',
    'after.unsupported': 'Action not supported', 'after.unsupportedBody': 'This system does not support the action to {action}.',
    'err.sender': 'Sender not allowed.', 'err.clipboard': 'Invalid clipboard request.', 'err.path': 'File location not allowed.', 'err.notFound': 'File not found. It may have been moved or deleted.',
    'err.openFailed': 'ZIVAR could not open', 'err.startFailed': 'ZIVAR could not start', 'err.portBusy': 'Port 18765 is in use by another application. Close it, then open ZIVAR again.',
    'err.noEngine': 'Download the update from the ZIVAR desktop engine.', 'err.upToDate': 'ZIVAR is already up to date.', 'err.feedUnreachable': 'The update server could not be reached.',
    'err.feedStatus': 'The update server replied HTTP {status}.', 'err.feedInvalid': 'The update information is invalid.', 'err.feedHttps': 'The update installer address must use HTTPS.',
    'err.feedChecksum': 'The update information has no SHA-256 checksum.', 'err.notReady': 'The update is not ready to install.', 'err.updateMissing': 'The downloaded update file was not found.',
    'err.externalBlocked': 'This address cannot be opened.', 'err.updateFailed': 'The update download failed.', 'err.installFailed': 'The update could not be started: {error}',
  },
  id: {
    'tray.open': 'Buka ZIVAR', 'tray.folder': 'Folder unduhan', 'tray.extension': 'Folder ekstensi browser', 'tray.quit': 'Keluar',
    'tray.notice.title': 'ZIVAR masih berjalan', 'tray.notice.body': 'Unduhan berlanjut di latar belakang. Buka ikon ZIVAR di system tray untuk kembali atau keluar.',
    'notify.done': 'Unduhan selesai', 'notify.failed': 'Unduhan gagal', 'notify.retry': 'Klik Lanjut untuk mencoba lagi.',
    'notify.updateAvailable': 'Pembaruan ZIVAR tersedia', 'notify.updateAvailableBody': 'Versi {v} siap diunduh. Buka Tentang → Periksa pembaruan.',
    'notify.updateReady': 'Pembaruan ZIVAR siap', 'notify.updateReadyBody': 'Versi {v} sudah diunduh dan diverifikasi. Buka Tentang untuk memasangnya.',
    'after.quit': 'menutup ZIVAR', 'after.sleep': 'membuat komputer tidur (sleep)', 'after.shutdown': 'mematikan komputer',
    'after.title': 'Semua unduhan selesai', 'after.message': 'ZIVAR akan {action} dalam 60 detik.', 'after.detail': 'Klik Batalkan untuk membatalkan.', 'after.cancel': 'Batalkan', 'after.now': 'Lakukan sekarang',
    'after.unsupported': 'Aksi tidak didukung', 'after.unsupportedBody': 'Sistem ini tidak mendukung aksi untuk {action}.',
    'err.sender': 'Pengirim tidak diizinkan.', 'err.clipboard': 'Permintaan clipboard tidak valid.', 'err.path': 'Lokasi file tidak diizinkan.', 'err.notFound': 'File tidak ditemukan. Mungkin sudah dipindahkan atau dihapus.',
    'err.openFailed': 'ZIVAR tidak dapat dibuka', 'err.startFailed': 'ZIVAR tidak dapat dimulai', 'err.portBusy': 'Port 18765 sedang dipakai aplikasi lain. Tutup aplikasi yang memakai port tersebut, lalu buka ZIVAR kembali.',
    'err.noEngine': 'Unduh pembaruan dari mesin ZIVAR desktop.', 'err.upToDate': 'ZIVAR sudah versi terbaru.', 'err.feedUnreachable': 'Server pembaruan tidak dapat dihubungi.',
    'err.feedStatus': 'Server pembaruan membalas HTTP {status}.', 'err.feedInvalid': 'Info pembaruan tidak valid.', 'err.feedHttps': 'Alamat installer pembaruan harus memakai HTTPS.',
    'err.feedChecksum': 'Info pembaruan tidak menyertakan checksum SHA-256.', 'err.notReady': 'Pembaruan belum siap dipasang.', 'err.updateMissing': 'File pembaruan yang diunduh tidak ditemukan.',
    'err.externalBlocked': 'Alamat ini tidak dapat dibuka.', 'err.updateFailed': 'Unduhan pembaruan gagal.', 'err.installFailed': 'Pembaruan tidak dapat dimulai: {error}',
  },
};
export function translator(getLanguage) {
  return (key, params) => {
    const language = dictionaries[getLanguage()] ? getLanguage() : 'en';
    const text = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : text;
  };
}
export const stringDictionaries = dictionaries;
