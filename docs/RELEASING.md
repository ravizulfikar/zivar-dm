# Releasing

[Bahasa Indonesia](id/RELEASING.md)

Releases are created by [.github/workflows/release.yml](../.github/workflows/release.yml) when a `v*` tag is pushed.

## Steps

1. Bump the version in **three places** that must match:
   - `package.json` (`version`)
   - `extension/manifest.json` (`version`)
   - `CHANGELOG.md`: add a `## [x.y.z] - YYYY-MM-DD` section above the previous one.
2. Run `npm test` and commit.
3. Create and push the tag:

   ```bash
   git tag v0.17.0
   git push origin main v0.17.0
   ```

4. The workflow runs:

   | Stage | What it does |
   | --- | --- |
   | `test` | `npm test` on Windows, and checks tag = `package.json` version = manifest version = present in the CHANGELOG |
   | `build` | Windows x64, macOS arm64 and x64, Linux x64 and arm64; helpers come from `scripts/ensure-vendor-binaries.mjs` (Windows) or `build/fetch-vendor.mjs` |
   | `publish` | Creates `SHA256SUMS.txt`, `latest.json`, release notes from the CHANGELOG, then the GitHub Release |

   Tags such as `v0.18.0-beta.1` are published as pre-releases.

Running the workflow from **Actions → Release → Run workflow** only builds and stores the artifacts, without creating a release.

## Files in a release

| Platform | Files |
| --- | --- |
| Windows x64 | `ZIVAR-Setup-<v>.exe`, `ZIVAR-<v>-Portable.exe` |
| macOS | `ZIVAR-<v>-mac-arm64.dmg` / `.zip`, `ZIVAR-<v>-mac-x64.dmg` / `.zip` |
| Linux x64 and arm64 | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |
| All | `SHA256SUMS.txt`, `latest.json` |

## In-app updates

`latest.json` lists one installer per platform (`win32-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`)
with its SHA-256. Point `zivar.updateFeed` in `package.json` at
`https://github.com/ravizulfikar/zivar-dm/releases/latest/download/latest.json` so the app checks it.

## Code signing (not set up yet)

Builds are currently unsigned. To add signing:

- **Windows**: a code-signing certificate through `CSC_LINK` and `CSC_KEY_PASSWORD`.
- **macOS**: an Apple Developer ID; remove `identity: null` from the configuration, add `CSC_LINK`/`CSC_KEY_PASSWORD`
  and notarization (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

Store all of them as GitHub Actions secrets, never in the repository.
