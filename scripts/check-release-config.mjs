#!/usr/bin/env node
// Static release-config integrity check.
//
// Fails the build if the Tauri config could ship a binary that loads the
// frontend from the dev server instead of the assets embedded in the binary —
// the `127.0.0.1 refused to connect` (ERR_CONNECTION_REFUSED) class of bug.
//
// Cheap and platform-independent, so it runs on every PR (check-frontend job).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const confPath = resolve(root, "src-tauri/tauri.conf.json");
const workflowPath = resolve(root, ".github/workflows/windows.yml");
const manifestScriptPath = resolve(root, "scripts/generate-updater-manifest.mjs");

let conf;
try {
  conf = JSON.parse(readFileSync(confPath, "utf8"));
} catch (e) {
  console.error(`Cannot read ${confPath}: ${e.message}`);
  process.exit(1);
}

const build = conf.build ?? {};
const { frontendDist, devUrl, beforeBuildCommand } = build;
const errors = [];

// 1. frontendDist must be a bundled local path, never a remote URL. A URL here
//    makes production builds load over the network / dev server instead of the
//    frontend embedded in the binary.
if (typeof frontendDist !== "string" || frontendDist.length === 0) {
  errors.push("build.frontendDist must be a non-empty path to the built frontend.");
} else if (/^https?:\/\//i.test(frontendDist)) {
  errors.push(
    `build.frontendDist must be a local path, not a URL (got "${frontendDist}"). ` +
      "A URL ships a build that loads the UI over the network.",
  );
}

// 2. devUrl, when set, must be loopback only. It is used solely by `tauri dev`;
//    a public host here would be a misconfiguration.
if (typeof devUrl === "string" && devUrl.length > 0) {
  let host = null;
  try {
    host = new URL(devUrl).hostname;
  } catch {
    host = null;
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    errors.push(`build.devUrl must be a loopback URL (got "${devUrl}").`);
  }
}

// 3. beforeBuildCommand must build the frontend so frontendDist is populated
//    before the Rust build embeds it.
if (typeof beforeBuildCommand !== "string" || !/build/i.test(beforeBuildCommand)) {
  errors.push('build.beforeBuildCommand must run the frontend build (e.g. "npm run build").');
}

// 4. When the frontend has already been built, frontendDist must resolve to a
//    real directory containing index.html. Skipped when the dir is absent
//    (this check can run before the build step in some contexts).
if (typeof frontendDist === "string" && !/^https?:\/\//i.test(frontendDist)) {
  const distPath = resolve(dirname(confPath), frontendDist);
  if (existsSync(distPath) && !existsSync(resolve(distPath, "index.html"))) {
    errors.push(
      `build.frontendDist ("${frontendDist}") resolves to ${distPath} but has no index.html.`,
    );
  }
}

// 5. Cross-platform releases require updater artifacts and native package
//    metadata. Catch path drift before a paid matrix run.
const bundle = conf.bundle ?? {};
if (bundle.createUpdaterArtifacts !== true) {
  errors.push("bundle.createUpdaterArtifacts must be true for signed cross-platform updates.");
}

for (const [field, expected] of [
  ["bundle.publisher", "Basebuild"],
  ["bundle.homepage", "https://basebuild.net"],
  ["bundle.category", "DeveloperTool"],
]) {
  const key = field.split(".")[1];
  if (bundle[key] !== expected) {
    errors.push(`${field} must be "${expected}" (got ${JSON.stringify(bundle[key])}).`);
  }
}

const nsis = bundle.windows?.nsis ?? {};

for (const [field, relativePath] of [
  ["bundle.windows.nsis.installerIcon", nsis.installerIcon],
  ["bundle.windows.nsis.uninstallerIcon", nsis.uninstallerIcon],
]) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    !existsSync(resolve(dirname(confPath), relativePath))
  ) {
    errors.push(`${field} must point to an existing icon.`);
  }
}

if (bundle.macOS?.signingIdentity !== "-") {
  errors.push(
    'bundle.macOS.signingIdentity must default to "-" so unsigned CI builds remain ad-hoc signed.',
  );
}

const macConfPath = resolve(dirname(confPath), "tauri.macos.conf.json");
if (!existsSync(macConfPath)) {
  errors.push("tauri.macos.conf.json must provide a macOS-safe bundle identifier.");
} else {
  try {
    const macConf = JSON.parse(readFileSync(macConfPath, "utf8"));
    if (
      typeof macConf.identifier !== "string" ||
      macConf.identifier.length === 0 ||
      macConf.identifier.endsWith(".app")
    ) {
      errors.push(
        `tauri.macos.conf.json identifier must be non-empty and must not end in ".app" (got ${JSON.stringify(macConf.identifier)}).`,
      );
    }
  } catch (e) {
    errors.push(`Cannot read ${macConfPath}: ${e.message}`);
  }
}

// 6. Empty Apple secret expressions must not reach tauri-action. Tauri treats
//    an empty APPLE_TEAM_ID as a notarization request and fails ad-hoc builds.
let workflow;
try {
  workflow = readFileSync(workflowPath, "utf8");
} catch (e) {
  errors.push(`Cannot read ${workflowPath}: ${e.message}`);
}

if (workflow) {
  const buildStep = workflow.match(
    /- name: Build and upload platform artifacts[\s\S]*?(?=\n {6}- name:)/,
  )?.[0];
  if (!buildStep) {
    errors.push("Release workflow must contain the parallel Tauri artifact build step.");
  } else {
    for (const variable of ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]) {
      if (new RegExp(`^\\s+${variable}:`, "m").test(buildStep)) {
        errors.push(
          `${variable} must be exported conditionally by the macOS signing step, not passed directly to tauri-action.`,
        );
      }
    }
    if (!buildStep.includes("uploadUpdaterJson: false")) {
      errors.push("Parallel platform builds must not write latest.json.");
    }
    if (!buildStep.includes("releaseId: ${{ needs.prepare-release.outputs.release_id }}")) {
      errors.push("Parallel platform builds must upload to the prepared draft release id.");
    }
  }

  for (const required of [
    "prepare-release:",
    "max-parallel: 3",
    "generate-updater-manifest:",
    "needs: generate-updater-manifest",
  ]) {
    if (!workflow.includes(required)) {
      errors.push(`Release workflow is missing parallel release contract: ${required}`);
    }
  }

  const verifyJob = workflow.match(/^  verify-release:\r?\n[\s\S]*$/m)?.[0];
  if (!verifyJob?.includes("contents: write")) {
    errors.push(
      "verify-release requires contents: write because GitHub hides draft releases from read-only tokens.",
    );
  }

  for (const [variable, source] of [
    ["APPLE_SIGNING_IDENTITY", "identity"],
    ["APPLE_ID", "APPLE_ID"],
    ["APPLE_PASSWORD", "APPLE_PASSWORD"],
    ["APPLE_TEAM_ID", "APPLE_TEAM_ID"],
  ]) {
    if (!workflow.includes(`echo "${variable}=$${source}" >> "$GITHUB_ENV"`)) {
      errors.push(`macOS signing step must export ${variable} through GITHUB_ENV.`);
    }
  }
}

if (!existsSync(manifestScriptPath)) {
  errors.push("Parallel releases require scripts/generate-updater-manifest.mjs.");
}

if (errors.length) {
  console.error("Release-config check FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "Release-config check passed: embedded frontend, updater settings, metadata, and native icons are valid.",
);
