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

if (errors.length) {
  console.error("Release-config check FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "Release-config check passed: production builds embed the local frontend; devUrl is loopback-only.",
);
