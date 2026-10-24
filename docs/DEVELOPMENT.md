# Development

[Bahasa Indonesia](id/DEVELOPMENT.md)

## Requirements

- Node.js 24 or newer
- Git
- To build installers: the target platform itself (Windows for `.exe`, macOS for `.dmg`, Linux for `.deb`/`.rpm`/`.AppImage`). Cross-platform builds are handled by GitHub Actions, see [RELEASING.md](RELEASING.md).

## Running

```bash
npm ci
npm start           # Electron: window, tray, notifications
npm run start:web   # server + UI only, http://127.0.0.1:18765
```

Local development data (`.data/`, `downloads/`) is not tracked by git. Set `ZIVAR_DESKTOP_DATA_DIR` and
`ZIVAR_DESKTOP_DOWNLOAD_DIR` to use other folders.

## Testing

```bash
npm test                          # unit tests: node --test tests/*.test.mjs
node scripts/<name>-smoke.mjs     # smoke tests with a real browser/Electron
```

Smoke tests open a real Chromium, Electron or Firefox and write their output to `artifacts/`.
Some are written for Windows. One-time setup:

```bash
node node_modules/electron/install.js                           # Electron binary
cd .tools/browser-test && node node_modules/playwright-core/cli.js install chromium
```

Note: on recent Chromium versions Playwright takes over download handling through DevTools, so
`chrome.downloads.onDeterminingFilename` never fires and the extension cannot intercept the download.
`scripts/extension-smoke.mjs` may fail at that step on some Chromium versions. If it does, send
`Browser.setDownloadBehavior` with `behavior: 'default'` over a CDP session before testing interception.
A few smoke tests (`desktop-smoke`, `video-overlay-smoke`) are timing-sensitive and sometimes need a rerun.

## Bundled helpers

Installers ship yt-dlp, a Node runtime for yt-dlp and FFmpeg in the `resources` folder.

- **Windows:** `node scripts/ensure-vendor-binaries.mjs` (called by `npm run build:win`) downloads pinned versions and checks their hashes.
- **macOS and Linux:** `build/fetch-vendor.mjs` fetches the latest yt-dlp release, the Node runtime matching your own Node, and FFmpeg from `ffmpeg-static`:

```bash
npm install --no-save ffmpeg-static
node build/fetch-vendor.mjs        # add --force to download again
```

The script verifies the SHA-256 of yt-dlp and Node. `ZIVAR_FFMPEG_PATH` (an absolute path) overrides the FFmpeg location.

## Building installers

```bash
npm run build:win
npm run build:mac     # on macOS
npm run build:linux   # on Linux
```

Output goes to `dist/`. Configuration: [build/electron-builder.yml](../build/electron-builder.yml).

## Icons and logo

The logo source is [docs/assets/logo.svg](assets/logo.svg). From it `desktop/assets/app.{png,ico,icns}`,
`app-1024.png` and `extension/icon-*.png` are generated. To regenerate everything after editing the SVG:

```bash
pip install pillow
python scripts/create-app-icon.py "<path to msedge.exe or chrome>"
```

## Browser extension

`extension/` can be loaded directly with **Load unpacked**. The default file-type and site lists live in two
places, `extension/background.js` and `app/manager.mjs`; `tests/browser-rules.test.mjs` checks that they match,
so change both together.

## Code style

Follow the surrounding files: ES modules (`.mjs`), no extra runtime dependencies, user-facing messages in
Indonesian, short comments that explain why.
