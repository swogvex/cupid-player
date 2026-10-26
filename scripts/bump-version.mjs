import fs from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: node scripts/bump-version.mjs X.Y.Z");
  process.exit(1);
}

const targets = [
  ["package.json", /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`],
  ["src-tauri/tauri.conf.json", /^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`],
  ["src-tauri/Cargo.toml", /^version = "[^"]*"/m, `version = "${version}"`],
];

for (const [file, pattern, replacement] of targets) {
  const text = fs.readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`No version found in ${file}`);
  fs.writeFileSync(file, text.replace(pattern, replacement));
  console.log("ok", file, "->", version);
}