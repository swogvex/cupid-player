# Third-party notices

cupid player's own code and art are released under the MIT License (see `LICENSE`).
The installer also ships the programs and fonts below, each under its own license.

## Programs launched by the app

cupid player runs these as separate processes; it does not link against them.

### yt-dlp 2026.08.19

- Used to search YouTube and download audio.
- License: the Windows executable is a PyInstaller bundle that includes GPLv3+ code, so the
  combined work is licensed under **GPL-3.0-or-later**. The list of bundled components is in
  `THIRD_PARTY_LICENSES.txt`, published with each yt-dlp release.
- Source code: https://github.com/yt-dlp/yt-dlp (release tag `2026.08.19`).
- Full text of the GPL: `licenses/GPL-3.0.txt`.

### FFmpeg (GPL build)

- Used to convert the downloaded audio to opus.
- Build: `ffmpeg-N-127709-g5993347a1b-win64-gpl.zip`, release `autobuild-2026-10-19-19-51` of
  https://github.com/yt-dlp/FFmpeg-Builds. That repository contains the scripts that produce the
  build; FFmpeg's own source is at https://github.com/FFmpeg/FFmpeg (revision `5993347a1b`).
- License: this is the `gpl` variant, licensed under the **GNU General Public License**.
  Full text: `licenses/GPL-3.0.txt`. FFmpeg is a trademark of Fabrice Bellard.
- If you cannot obtain the source code for these binaries, open an issue at
  https://github.com/swogvex/cupid-player/issues and it will be provided.

## Fonts

All three are licensed under the SIL Open Font License 1.1. The license texts, which name each
copyright holder, are in `licenses/`.

| Font | Used for | License file |
|------|----------|--------------|
| Pixelify Sans | Interface text | `licenses/OFL-PixelifySans.txt` |
| Galmuri9 | Korean lyrics | `licenses/OFL-Galmuri.txt` |
| DotGothic16 | Japanese lyrics | `licenses/OFL-DotGothic16.txt` |

## Online services

- Lyrics are fetched from [LRCLIB](https://lrclib.net) and stored locally. The lyrics belong to
  their rights holders; cupid player only displays the copy you fetched.
- cupid player is not affiliated with Spotify or YouTube.

## Libraries

The app is built with Tauri, React and many Rust crates and npm packages, each under its own
open source license. See `Cargo.lock` and `pnpm-lock.yaml` for the exact versions.