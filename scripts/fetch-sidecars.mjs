// Downloads yt-dlp and ffmpeg into src-tauri/binaries/ and verifies SHA-256.
// Usage: pnpm sidecars:fetch [--force]
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
const FORCE = process.argv.includes("--force");

// Only these hosts/prefixes are allowed (supply-chain hygiene).
const ALLOWED_PREFIXES = [
  "https://github.com/yt-dlp/yt-dlp/releases/",
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/",
];

const SOURCES = {
  ytdlp: {
    exe: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
    sums: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS",
    sumsName: "yt-dlp.exe",
  },
  ffmpeg: {
    zip: "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    sums: "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256",
    sumsName: "ffmpeg-master-latest-win64-gpl.zip",
    // Add "ffprobe" here if the A-04 test shows yt-dlp needs it.
    extract: ["ffmpeg"],
  },
};

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

async function expectedHash(sumsUrl, name, tmp) {
  const file = join(tmp, "sums.txt");
  await download(sumsUrl, file);
  const text = (await import("node:fs")).readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(?:\.\/)?(.+)$/);
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  throw new Error(`No checksum entry for ${name}`);
}

async function fetchYtdlp(tmp) {
  const dest = join(BIN_DIR, `yt-dlp-${TRIPLE}.exe`);
  if (existsSync(dest) && !FORCE) return console.log("yt-dlp: already present (use --force)");
  const part = join(tmp, "yt-dlp.exe");
  await download(SOURCES.ytdlp.exe, part);
  const want = await expectedHash(SOURCES.ytdlp.sums, SOURCES.ytdlp.sumsName, tmp);
  const got = await sha256(part);
  if (got !== want) throw new Error(`yt-dlp hash mismatch\n  want ${want}\n  got  ${got}`);
  copyFileSync(part, dest);
  console.log("yt-dlp: OK", got);
}

async function fetchFfmpeg(tmp) {
  const wanted = SOURCES.ffmpeg.extract.map((n) => join(BIN_DIR, `${n}-${TRIPLE}.exe`));
  if (wanted.every(existsSync) && !FORCE) return console.log("ffmpeg: already present (use --force)");
  const zip = join(tmp, "ffmpeg.zip");
  await download(SOURCES.ffmpeg.zip, zip);
  const want = await expectedHash(SOURCES.ffmpeg.sums, SOURCES.ffmpeg.sumsName, tmp);
  const got = await sha256(zip);
  if (got !== want) throw new Error(`ffmpeg hash mismatch\n  want ${want}\n  got  ${got}`);

  const out = join(tmp, "ffmpeg-extracted");
  mkdirSync(out);
  // bsdtar ships with Windows 10+ and with windows-latest runners; it reads zip files.
  execFileSync("tar", ["-xf", zip, "-C", out], { stdio: "inherit" });
  const top = readdirSync(out).find((d) => statSync(join(out, d)).isDirectory());
  if (!top) throw new Error("Unexpected zip layout");
  for (const name of SOURCES.ffmpeg.extract) {
    copyFileSync(join(out, top, "bin", `${name}.exe`), join(BIN_DIR, `${name}-${TRIPLE}.exe`));
  }
  console.log("ffmpeg: OK", got);
}

mkdirSync(BIN_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "cupid-sidecars-"));
try {
  await fetchYtdlp(tmp);
  await fetchFfmpeg(tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}