# Third-party notices

ZIVAR Download Manager itself is released under the [MIT License](LICENSE). Installers also
bundle the following programs, which keep their own licenses.

| Component | Used for | License | Source |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) | Desktop shell (includes Chromium) | MIT, Chromium and bundled third-party licenses | https://github.com/electron/electron |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Reading YouTube and other video sites | The Unlicense (the standalone build also bundles third-party components, see `THIRD_PARTY_LICENSES.txt` in the installer) | https://github.com/yt-dlp/yt-dlp |
| [Node.js](https://nodejs.org/) | JavaScript runtime used by yt-dlp | MIT (see `NODE-LICENSE` in the installer) | https://github.com/nodejs/node |
| [FFmpeg](https://ffmpeg.org/) | Merging and converting video and audio | GPL v3 (build used by the installers is a GPL build) | https://ffmpeg.org/download.html |

FFmpeg is shipped as a separate executable and is not linked into ZIVAR. The FFmpeg build
used for each release is obtained from the
[`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) package; its source code and
build instructions are available from the links above. The license texts that accompany
each helper are placed next to it in the `resources` folder of the installed application.

"YouTube" and other names are trademarks of their respective owners. ZIVAR is not affiliated
with or endorsed by them.
