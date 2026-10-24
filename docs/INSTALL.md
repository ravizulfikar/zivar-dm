# Install guide

[Bahasa Indonesia](id/INSTALL.md)

Download the right file from the [Releases](https://github.com/ravizulfikar/zivar-dm/releases/latest) page. Every release includes
`SHA256SUMS.txt`; compare it before opening a file.

```bash
# Linux / macOS
sha256sum -c SHA256SUMS.txt --ignore-missing      # Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing  # macOS
```

```powershell
# Windows
Get-FileHash .\ZIVAR-Setup-0.17.0.exe -Algorithm SHA256
```

## Windows 10/11

- **Installer** (`ZIVAR-Setup-<version>.exe`): choose an install folder; shortcuts are created automatically. User data is kept when you uninstall.
- **Portable** (`ZIVAR-<version>-Portable.exe`): run it directly, no installation needed.

If SmartScreen shows a warning, click **More info → Run anyway**. Builds are not code-signed yet.

## macOS 12 or newer

1. Open `ZIVAR-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel).
2. Drag **ZIVAR Download Manager** to **Applications**.
3. On first launch macOS may refuse because the app is not notarized. Right-click the app → **Open** → **Open**, or run:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/ZIVAR Download Manager.app"
   ```

The `.zip` archive contains the same app without the DMG.

## Ubuntu, Debian, Linux Mint, Pop!_OS

```bash
sudo apt install ./ZIVAR-<version>-linux-amd64.deb     # x64
sudo apt install ./ZIVAR-<version>-linux-arm64.deb     # arm64 (64-bit Raspberry Pi OS, ...)
```

The app appears in the **Internet/Network** menu and is installed in `/opt/ZIVAR Download Manager`.
Remove it with `sudo apt remove zivar-download-manager`.

## Fedora, RHEL, openSUSE

```bash
sudo dnf install ./ZIVAR-<version>-linux-x86_64.rpm      # Fedora, RHEL
sudo zypper install ./ZIVAR-<version>-linux-x86_64.rpm   # openSUSE
```

## Other distributions (Arch, Manjaro, ...)

**AppImage**

```bash
chmod +x ZIVAR-<version>-linux-x86_64.AppImage
./ZIVAR-<version>-linux-x86_64.AppImage
```

**tar.gz archive**

```bash
tar -xzf ZIVAR-<version>-linux-x64.tar.gz
# run the "zivar-download-manager" file inside the extracted folder
```

## Installing the browser extension

See **Installing the browser extension** in the [README](../README.md). The extension folder is at:

| System | Location |
| --- | --- |
| Windows | `%APPDATA%\ZIVAR Download Manager\browser-extension` |
| macOS | `~/Library/Application Support/ZIVAR Download Manager/browser-extension` |
| Linux | `~/.config/ZIVAR Download Manager/browser-extension` |

The tray menu item **Folder ekstensi Chrome** opens that folder directly.

## Data location

The queue, settings, pairing token and log (`desktop.log`) are stored in the app data folder
(the parent of the extension folder above). Downloaded files go to `Downloads/ZIVAR` by default.

## Troubleshooting

**Linux: the AppImage will not start on Ubuntu 24.04 (sandbox error).**
Ubuntu 24.04 restricts unprivileged user namespaces. Run `./ZIVAR-...AppImage --no-sandbox`,
or install the `.deb` package, which sets up the sandbox helper correctly.

**Linux: the AppImage asks for FUSE.**
Install `libfuse2` (`sudo apt install libfuse2t64` on Ubuntu 24.04) or run it with
`--appimage-extract-and-run`.

**Linux: no tray icon on GNOME.**
GNOME does not show tray icons by default. Install the *AppIndicator and KStatusNotifierItem Support* extension.
Closing the window still hides the app to the background; reopen it from the application menu.

**Port 18765 is already in use.**
Close the other application using it. The browser extension always connects to `127.0.0.1:18765`,
so the port cannot be changed while you use the extension.

**YouTube downloads fail.**
Open **Settings** and run the extractor update, or leave the weekly automatic update turned on.
