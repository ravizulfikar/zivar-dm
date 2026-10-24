# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

All notable changes to ZIVAR Download Manager are recorded in this file.

## [0.18.1] - 2026-10-25

### Fixed

- Chrome no longer reports "Cannot create item with duplicate id zivar-download" from the extension. The right-click menu was rebuilt from several places at once (on install, on start-up and when the language changed); rebuilds now run one after another.

## [0.18.0] - 2026-10-25

### Added

- English is now the default language, with an EN/ID switch in the sidebar. It covers the app, the browser extension, and the desktop notifications and dialogs. The choice is saved in the settings and the extension follows it.
- An About dialog with the logo, version, system, engine (Electron/Chromium/Node), YouTube extractor version, developer, website https://zivar.my.id, and license.
- In-app updates: check, download, verify the SHA-256 checksum, and install with one click. "Download updates automatically" is on by default, and a dot appears next to the version when an update is available or ready.
- Updates recognise how ZIVAR was installed: the Windows installer, the portable build, the macOS DMG, an AppImage, and `.deb` or `.rpm` packages.
- `latest.json` now lists portable, `.deb` and `.rpm` variants.
- Engine messages (download errors, YouTube, FFmpeg) are translated to English when the interface is in English, with a test that fails when a new message is missing from the translation.

### Changed

- A redesigned interface: a sidebar with navigation and categories, download cards with progress bars, a summary of speed/active/waiting/completed, and a sort menu. Colours come from the logo (teal to indigo) with dark and light themes (following the system on first launch). It replaces the classic menu bar, toolbar and table.
- "About ZIVAR" is now simply "About".
- The update feed address points to GitHub releases.
- The "Windows" wording in the start-at-login setting now says "computer".

### Fixed

- The extension no longer depends on Indonesian error text from the server.
- An update download that is removed from the list is offered again instead of showing a stale state.

## [0.17.0] - 2026-10-24

### Added

- macOS (Apple Silicon and Intel) and Linux (x64 and arm64) support: `.dmg`, `.AppImage`, `.deb` for Ubuntu/Debian/Linux Mint, `.rpm` for Fedora/openSUSE, and `.tar.gz`.
- A new ZIVAR logo and icons for the app, installers, system tray and browser extension.
- MIT license, `THIRD_PARTY_NOTICES.md`, and full documentation in `README.md` and `docs/`.
- A GitHub Actions release workflow: automatic builds for five targets, `SHA256SUMS.txt`, and `latest.json` for update checks.
- The update feed can list one installer per platform (`platforms`), so a single `latest.json` serves Windows, macOS and Linux.
- A test that keeps the extension's built-in file-type and site lists identical to the app's.

### Changed

- Start at login now works on macOS and Linux (an XDG autostart entry), not only Windows.
- The actions after all downloads finish (shut down, sleep) use each platform's own commands.
- The open-download-folder button uses Finder on macOS and `xdg-open` on Linux.
- Helper names for the yt-dlp extractor and runtime follow the platform (`.exe` only on Windows).

### Fixed

- The excluded-site pattern check treats the dot as a literal dot; before, characters such as `_` passed as label separators.
- Files that could be executed on macOS and Linux (`.sh`, `.AppImage`, `.deb`, `.dmg` and others) are only shown in the folder, never opened automatically.

## [0.16.4] - 2026-10-22

### Fixed

- Clicking a captured file goes straight to the ZIVAR info dialog without creating a browser download.
- Redirected downloads such as GitHub Releases are cancelled while the file name is still being determined, not just paused before the Save As dialog.
- The file name from Content-Disposition is kept, including for asset URLs that are only an ID.
- Closing the ZIVAR info dialog cancels the choice; the browser download only starts if the user picks Continue in Chrome.
- Disabled capture, file types and excluded sites are still respected; the download passes through to the page when the local app is not available.
- The info dialog shows the extension version to make update checks easier.

### Validation

- The Chromium smoke test covers a click without a browser download item, an attachment redirect without a URL extension, cancelling the browser item, and a byte-exact result file in ZIVAR.

## [0.16.3] - 2026-10-22

### Fixed

- Downloads triggered by a page button or script are now captured when they produce a synthetic file-link click.
- Interception starts at `pointerdown`/`mousedown` so page handlers cannot open the browser dialog first.
- The same pointer, mouse and click events are de-duplicated so one click creates one `Download Info`.

## [0.16.2] - 2026-10-22

### Fixed

- Clicks on file links that are on the capture list are intercepted before Chrome/Firefox creates a page download.
- Downloads created by the extension use `saveAs: false`, so the browser's `Save As` dialog does not appear together with ZIVAR's `Download Info`.
- Downloads created by direct navigation, scripts or forms still use the `onCreated`/`onDeterminingFilename` fallback.

## [0.16.1] - 2026-10-22

### Fixed

- The Windows build now makes sure `yt-dlp.exe`, the Node runtime and `ffmpeg.exe` are present and validated before the installer is built.
- An extractor error caused by a missing executable now shows a clear recovery message.

## [0.16.0] - 2026-10-22

### Added

- Automatic browser-download filtering by file extension with a built-in list of common types.
- `R0*` and `R1*` wildcards for multipart archives.
- A list of sites that must not start automatic capture, including subdomain wildcards.
- A Browser integration setting to edit both lists without editing the extension.

### Changed

- The excluded-site list always takes priority over the extension list.
- Emptying the extension list turns automatic browser-download capture off.

## [0.15.0] - 2026-10-22

### Added

- An information dialog for ordinary browser downloads, including EXE, MSI, ZIP, PDF and other documents.
- File name, size, MIME type and source address shown before a download is moved to ZIVAR.
- A `Start download` button that puts the file in the ZIVAR queue.
- A `Continue in Chrome` button that lets the browser finish the file.
- Recovery of pending downloads after the extension's service worker restarts.

### Changed

- Download capture is on by default when the extension is first installed.
- Users can still turn capture off from the extension popup.
- The Chrome download is cancelled once the job is created in the ZIVAR queue, so the file is not saved twice.

### Fixed

- Temporary browser credentials are kept in the extension's session storage, not permanent storage.
- The download ID from the info page is validated before it is processed.
- The extension smoke test and manifest mock follow the new download dialog flow.
