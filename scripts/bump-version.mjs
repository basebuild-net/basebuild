// Bump the patch version across package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
// Run with: node scripts/bump-version.mjs
// Does not modify the major or minor components, so 0.0.1 -> 0.0.2 etc.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function bumpPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid version: ${version}`);
  }
  return `${major}.${minor}.${patch + 1}`;
}

async function updateJson(path, version) {
  const file = await readFile(path, "utf8");
  const data = JSON.parse(file);
  const old = data.version;
  data.version = version;
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`${path}: ${old} -> ${version}`);
}

async function updateToml(path, version) {
  const file = await readFile(path, "utf8");
  const updated = file.replace(
    /^version = "[0-9]+\.[0-9]+\.[0-9]+"$/m,
    `version = "${version}"`,
  );
  if (updated === file) {
    throw new Error(`Could not find version line in ${path}`);
  }
  await writeFile(path, updated);
  const old = file.match(/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/m)?.[1];
  console.log(`${path}: ${old} -> ${version}`);
}

async function main() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const newVersion = bumpPatch(packageJson.version);

  await updateJson("package.json", newVersion);
  await updateJson("src-tauri/tauri.conf.json", newVersion);
  await updateToml("src-tauri/Cargo.toml", newVersion);

  console.log(`\nVersion bumped to ${newVersion}.`);
  console.log("Commit the changes and push a tag to trigger a release:");
  console.log(`  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`);
  console.log(`  git commit -m "chore(release): bump version to ${newVersion}"`);
  console.log(`  git tag v${newVersion}`);
  console.log(`  git push origin main v${newVersion}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
