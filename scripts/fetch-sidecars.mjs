// Downloads yt-dlp and ffmpeg into src-tauri/binaries/ at the versions pinned in
// scripts/sidecars.lock.json and verifies SHA-256 against the hashes in that file.
// Usage: pnpm sidecars:fetch [--force] [--print-hashes]
//   --force         download again even if the installed file already matches the pin
//   --print-hashes  download and print the hashes without installing (to fill the lock file)
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TRIPLE = "x86_64-pc-windows-msvc";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(ROOT, "src-tauri", "binaries");
const LOCK = JSON.parse(readFileSync(join(ROOT, "scripts", "sidecars.lock.json"), "utf8"));
const FORCE = process.argv.includes("--force");
const PRINT = process.argv.includes("--print-hashes");
const HEX64 = /^[0-9a-f]{64}$/;

// Only these prefixes are allowed (supply-chain hygiene).
const ALLOWED_PREFIXES = [
  "https://github.com/yt-dlp/yt-dlp/releases/download/",
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/",
];

function pinned(value, label) {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new Error(
      `${label} is not pinned in scripts/sidecars.lock.json (run: pnpm sidecars:fetch --print-hashes)`,
    );
  }
  return value;
}

function ytdlpUrl() {
  const v = LOCK.ytdlp.version;
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(v)) throw new Error(`Bad yt-dlp version: ${v}`);
  return `https://github.com/yt-dlp/yt-dlp/releases/download/${v}/yt-dlp.exe`;
}

function ffmpegUrl() {
  const { tag, asset } = LOCK.ffmpeg;
  if (!/^[A-Za-z0-9._-]+$/.test(tag ?? "")) throw new Error(`Bad ffmpeg tag: ${tag}`);
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(asset ?? "")) throw new Error(`Bad ffmpeg asset: ${asset}`);
  return `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/${tag}/${asset}`;
}

function assertAllowed(url) {
  if (!ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
    throw new Error(`URL not allowed: ${url}`);
  }
}

async function download(url, dest) {
  assertAllowed(url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function fetchYtdlp(tmp) {
  const dest = join(BIN_DIR, `yt-dlp-${TRIPLE}.exe`);
  const want = PRINT ? null : pinned(LOCK.ytdlp.sha256, "yt-dlp sha256");

  if (!PRINT && !FORCE && existsSync(dest)) {
    if ((await sha256(dest)) === want) return console.log("yt-dlp: already at the pinned version");
    console.log("yt-dlp: installed file differs from the pin, replacing it");
  }

  const part = join(tmp, "yt-dlp.exe");
  await download(ytdlpUrl(), part);
  const got = await sha256(part);

  if (PRINT) {
    console.log(`yt-dlp ${LOCK.ytdlp.version}\n  "sha256": "${got}"`);
    return;
  }
  if (got !== want) throw new Error(`yt-dlp hash mismatch\n  want ${want}\n  got  ${got}`);
  copyFileSync(part, dest);
  console.log("yt-dlp: OK", got);
}

async function fetchFfmpeg(tmp) {
  const dest = join(BIN_DIR, `ffmpeg-${TRIPLE}.exe`);
  const wantZip = PRINT ? null : pinned(LOCK.ffmpeg.zipSha256, "ffmpeg zipSha256");
  const wantExe = PRINT ? null : pinned(LOCK.ffmpeg.exeSha256, "ffmpeg exeSha256");

  if (!PRINT && !FORCE && existsSync(dest)) {
    if ((await sha256(dest)) === wantExe) return console.log("ffmpeg: already at the pinned version");
    console.log("ffmpeg: installed file differs from the pin, replacing it");
  }

  const zip = join(tmp, "ffmpeg.zip");
  await download(ffmpegUrl(), zip);
  const gotZip = await sha256(zip);
  if (!PRINT && gotZip !== wantZip) {
    throw new Error(`ffmpeg zip hash mismatch\n  want ${wantZip}\n  got  ${gotZip}`);
  }

  const out = join(tmp, "ffmpeg-extracted");
  mkdirSync(out);
  // bsdtar ships with Windows 10+ and with windows-latest runners; it reads zip files.
  execFileSync("tar", ["-xf", zip, "-C", out], { stdio: "inherit" });
  const top = readdirSync(out).find((d) => statSync(join(out, d)).isDirectory());
  if (!top) throw new Error("Unexpected zip layout");
  const extracted = join(out, top, "bin", "ffmpeg.exe");
  const gotExe = await sha256(extracted);

  if (PRINT) {
    console.log(
      `ffmpeg ${LOCK.ffmpeg.tag}\n  "zipSha256": "${gotZip}",\n  "exeSha256": "${gotExe}"`,
    );
    return;
  }
  if (gotExe !== wantExe) {
    throw new Error(`ffmpeg.exe hash mismatch\n  want ${wantExe}\n  got  ${gotExe}`);
  }
  copyFileSync(extracted, dest);
  console.log("ffmpeg: OK", gotExe);
}

mkdirSync(BIN_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "cupid-sidecars-"));
try {
  await fetchYtdlp(tmp);
  await fetchFfmpeg(tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}