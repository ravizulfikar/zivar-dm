<p align="center">
  <img src="docs/assets/logo.png" width="128" alt="ZIVAR Download Manager logo">
</p>

<h1 align="center">ZIVAR Download Manager</h1>

<p align="center">
  A local download manager with a queue, multi-connection downloads, YouTube, HLS/DASH<br>
  and a browser companion extension. For Windows, macOS and Linux.
</p>

<p align="center">
  <a href="https://github.com/ravizulfikar/zivar-dm/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/ravizulfikar/zivar-dm/ci.yml?branch=main&label=CI&logo=github"></a>
  <a href="https://github.com/ravizulfikar/zivar-dm/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/ravizulfikar/zivar-dm?label=release"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/ravizulfikar/zivar-dm?label=license"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.id.md">Bahasa Indonesia</a>
</p>

<p align="center">
  <a href="https://github.com/ravizulfikar/zivar-dm/releases/latest">Download</a> ·
  <a href="docs/INSTALL.md">Install guide</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="docs/DEVELOPMENT.md">Development</a> ·
  <a href="LICENSE">MIT License</a>
</p>

---

> **Note:** the application interface is currently in Indonesian. The documentation is available in English and Indonesian.

## Features

**Download engine**
- Multi-connection downloads with resume; connections per file and simultaneous downloads are configurable.
- Reorderable queue, queue schedule, speed limiter and HTTP proxy.
- Automatic categories (Video, Audio, Documents, Programs, ...) with per-category subfolders.
- Refresh an expired download address, verify checksums (SHA-256 and others), and supply an expected checksum when adding a download.
- Add many URLs at once, including patterns such as `photo[001-120].jpg`, plus a **Site Grabber** that collects files from a page.
- Clipboard monitor, desktop notifications, and an action to run when all downloads finish (quit, sleep, shut down).
- Lives in the system tray and can start automatically at login.

**Video**
- YouTube through yt-dlp: choose a resolution, audio only (M4A/MP3), subtitles, or a whole playlist. The extractor can update itself every week.
- HLS (including AES-128) and DASH, also through the browser for CDNs that reject ordinary clients.
- A download button directly on the site's video player.
- DRM-protected video is **not** supported.

**Browser extension (Chrome, Edge, Brave and other Chromium browsers; a Firefox build is available)**
- An info dialog before a file is handed over to ZIVAR: name, size, type and source address.
- File-type and excluded-site lists that you edit from the app.
- Temporary credentials (cookies, referer) are sent only to the local app and are never stored permanently.

**Privacy and security**
- Everything runs locally. The app listens on `127.0.0.1` only and uses a pairing token.
- App updates are downloaded through ZIVAR's own queue, verified against SHA-256 and never run automatically.
- Built with Electron fuses (`runAsNode` disabled, ASAR integrity verified).

## Download and install

Get the latest version from the [Releases](https://github.com/ravizulfikar/zivar-dm/releases/latest) page.

| System | File | Notes |
| --- | --- | --- |
| Windows 10/11 (x64) | `ZIVAR-Setup-<version>.exe` | Installer. |
| | `ZIVAR-<version>-Portable.exe` | No installation needed. |
| macOS (Apple Silicon) | `ZIVAR-<version>-mac-arm64.dmg` | See the Gatekeeper note below. |
| macOS (Intel) | `ZIVAR-<version>-mac-x64.dmg` | |
| Ubuntu, Debian, Linux Mint, Pop!_OS | `ZIVAR-<version>-linux-amd64.deb` / `-arm64.deb` | `sudo apt install ./file.deb` |
| Fedora, RHEL, openSUSE | `ZIVAR-<version>-linux-x86_64.rpm` / `-aarch64.rpm` | `sudo dnf install ./file.rpm` |
| Other Linux (Arch, ...) | `ZIVAR-<version>-linux-<arch>.AppImage` | `chmod +x file.AppImage && ./file.AppImage` |
| | `ZIVAR-<version>-linux-<arch>.tar.gz` | Plain archive. |

Linux builds exist for x64 and arm64. Compare your download with `SHA256SUMS.txt` on the release page. Full steps, troubleshooting and how to install the extension are in [docs/INSTALL.md](docs/INSTALL.md).

**macOS:** builds are not signed by Apple. If you see "cannot be verified", right-click the app and choose **Open**, or run `xattr -dr com.apple.quarantine "/Applications/ZIVAR Download Manager.app"`.

**Windows:** SmartScreen may warn because the installer is not code-signed. Match the checksum, then choose **More info → Run anyway**.

## Installing the browser extension

The extension ships inside the app and is copied to the data folder the first time ZIVAR starts.

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the ZIVAR extension folder (its location is shown in the **Chrome guide** dialog in the app).
3. Click the ZIVAR Download Companion icon, paste the **pairing code** from the app, then click **Connect**.

## Quick tour

- **Add URL** takes one or many links; or copy a URL and let the clipboard monitor add it.
- Click a file link in the browser: ZIVAR shows the info dialog, then **Start download** moves it into the queue, or **Continue in Chrome** lets the browser download it instead.
- Open a video tab, play it, and click **Download video** in the player corner to pick a quality.
- Settings (connections, schedule, proxy, captured file types, start at login) are under **Download settings**.

## Updates

ZIVAR can check for updates from a JSON feed. Every GitHub release includes a `latest.json` covering Windows, macOS and Linux. Set `zivar.updateFeed` in `package.json` (or the `ZIVAR_UPDATE_FEED` environment variable) to its HTTPS address:

```
https://github.com/ravizulfikar/zivar-dm/releases/latest/download/latest.json
```

The installer address must use HTTPS and come with a SHA-256 checksum; a downloaded installer is never run automatically.

## Development

Requires Node.js 24 or newer.

```bash
npm ci
npm start          # desktop app (Electron)
npm run start:web  # server + UI only at http://127.0.0.1:18765
npm test
```

How to build installers, run the smoke tests and publish a release is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/RELEASING.md](docs/RELEASING.md).

## Project layout

| Folder | Contents |
| --- | --- |
| `app/` | Download engine, local HTTP server, YouTube/FFmpeg integration and the web UI |
| `desktop/` | Electron shell: window, tray, notifications, autostart, power actions |
| `extension/` | Manifest V3 browser extension |
| `build/` | Packaging configuration and release scripts |
| `scripts/` | Smoke tests and helper scripts |
| `tests/` | Unit tests (`node --test`) |
| `docs/` | Documentation (English, with Indonesian in `docs/id/`) and logo assets |

## License

ZIVAR's own code is released under the [MIT License](LICENSE). The installers also bundle Electron, yt-dlp, Node.js and FFmpeg, each under its own license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Use ZIVAR only for content you have the right to download, and follow the terms of service of the sites you use.
