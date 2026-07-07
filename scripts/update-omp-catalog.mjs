#!/usr/bin/env node
// Re-pulls the OMP model catalog from upstream and stamps a content-hash
// version used by cache-invalidation logic.
//
// Usage: node scripts/update-omp-catalog.mjs

import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = resolve(__dirname, "../src-tauri/vendor/omp-catalog");
const CATALOG_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/refs/heads/main/packages/catalog/src/models.json";
const LICENSE_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/refs/heads/main/LICENSE";

async function main() {
  console.log("Fetching OMP catalog from upstream...");
  const catalogResponse = await fetch(CATALOG_URL);
  if (!catalogResponse.ok) {
    throw new Error(`Failed to fetch catalog: ${catalogResponse.status} ${catalogResponse.statusText}`);
  }
  const catalogText = await catalogResponse.text();

  // Validate it parses as JSON before writing.
  const parsed = JSON.parse(catalogText);
  const providerCount = Object.keys(parsed).length;
  let modelCount = 0;
  for (const models of Object.values(parsed)) {
    modelCount += Object.keys(models).length;
  }
  console.log(`  ${providerCount} providers, ${modelCount} models`);

  // Content-hash version stamp (SHA-256 of the canonical JSON, first 16 hex chars).
  const version = createHash("sha256").update(catalogText).digest("hex").slice(0, 16);
  console.log(`  catalog version: ${version}`);

  await mkdir(VENDOR_DIR, { recursive: true });
  await writeFile(resolve(VENDOR_DIR, "models.json"), catalogText, "utf8");
  await writeFile(resolve(VENDOR_DIR, "VERSION"), version + "\n", "utf8");

  console.log("Fetching OMP license...");
  const licenseResponse = await fetch(LICENSE_URL);
  if (licenseResponse.ok) {
    await writeFile(resolve(VENDOR_DIR, "LICENSE.md"), await licenseResponse.text(), "utf8");
  } else {
    console.warn(`  warning: could not fetch license (${licenseResponse.status})`);
  }

  console.log("Done. Review the diff before committing.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
