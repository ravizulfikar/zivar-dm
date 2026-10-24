#!/bin/sh
# Ubuntu 24.04 and later restrict unprivileged user namespaces, which Chromium's sandbox
# relies on. Packages install the SUID helper, so make sure it has the right mode.
SANDBOX="/opt/ZIVAR Download Manager/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null || true
  chmod 4755 "$SANDBOX" 2>/dev/null || true
fi
# Helper binaries shipped in resources must be executable.
for f in /opt/*/resources/yt-dlp/yt-dlp /opt/*/resources/yt-dlp/node /opt/*/resources/ffmpeg/ffmpeg; do
  [ -f "$f" ] && chmod 755 "$f" 2>/dev/null || true
done
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications 2>/dev/null || true
exit 0
