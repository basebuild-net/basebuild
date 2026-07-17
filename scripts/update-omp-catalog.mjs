#!/usr/bin/env node
// Refreshes the bundled model catalog (src-tauri/vendor/omp-catalog/models.json):
//
//   1. Pulls the upstream OMP catalog (baseline: providers, models, wire
//      protocol kinds, base URLs, costs).
//   2. Overlays the basebuild.net desktop catalog (GET /api/catalog/desktop)
//      so models that launched upstream of OMP — or that only basebuild
//      tracks — are present in the bundled file with enough information to
//      connect (provider slug, model API id, wire kind, base URL).
//   3. Writes a deterministic serialization and stamps a content-hash VERSION
//      used by the cache-invalidation logic in provider_model_catalog_service.
//
// The basebuild overlay is fail-soft: if basebuild.net is unreachable the OMP
// baseline still updates. Overlay entries are additive only — they never
// overwrite an existing OMP entry.
//
// Usage: node scripts/update-omp-catalog.mjs
// Env:   BASEBUILD_CATALOG_URL overrides https://basebuild.net (dev/testing).

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
const BASEBUILD_BASE_URL = (
  process.env.BASEBUILD_CATALOG_URL || "https://basebuild.net"
).replace(/\/+$/, "");
// Must match SUPPORTED_CATALOG_VERSION in catalog_sync_service.rs — a newer
// response shape is refused, not ingested.
const SUPPORTED_DESKTOP_CATALOG_VERSION = 2;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** The most common value of `field` across a provider's existing models. */
function modalValue(models, field) {
  const counts = new Map();
  for (const model of Object.values(models)) {
    const value = model?.[field];
    if (typeof value === "string" && value.length > 0) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Overlay basebuild.net's desktop catalog onto the OMP baseline. Adds only
 * models that are missing AND connectable (wire kind + base URL known).
 * Mutates `catalog`; returns { providersAdded, modelsAdded, skipped }.
 */
function overlayBasebuildCatalog(catalog, desktop) {
  const stats = { providersAdded: 0, modelsAdded: 0, skipped: 0 };
  for (const provider of desktop.providers ?? []) {
    const slug = provider?.slug;
    if (typeof slug !== "string" || slug.length === 0) continue;
    const existing = catalog[slug];
    const apiKind =
      (typeof provider.apiKind === "string" && provider.apiKind) ||
      (existing ? modalValue(existing, "api") : null);
    const baseUrl =
      (typeof provider.apiUrl === "string" && provider.apiUrl) ||
      (existing ? modalValue(existing, "baseUrl") : null);
    if (!apiKind || !baseUrl) {
      // Not connectable — the runtime catalog sync still surfaces these once
      // basebuild.net publishes routing info; the bundle only ships models
      // the app can actually call.
      const count = Array.isArray(provider.models) ? provider.models.length : 0;
      if (!existing && count > 0) {
        console.warn(
          `  skipping provider '${slug}': no apiKind/apiUrl (${count} models)`,
        );
        stats.skipped += count;
      }
      continue;
    }
    let bucket = existing;
    if (!bucket) {
      bucket = {};
      catalog[slug] = bucket;
      stats.providersAdded += 1;
    }
    for (const model of provider.models ?? []) {
      const apiId =
        (typeof model.apiId === "string" && model.apiId) || model.slug;
      if (typeof apiId !== "string" || apiId.length === 0) continue;
      // Keys in models.json are the provider-facing model ids; skip anything
      // already present under either its API id or its canonical slug.
      if (bucket[apiId] || (model.slug && bucket[model.slug])) continue;
      const modalities = String(model.inputModalities ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      bucket[apiId] = {
        id: apiId,
        name: model.name || apiId,
        api: apiKind,
        provider: slug,
        baseUrl,
        reasoning: Boolean(model.reasoning),
        input: modalities.length > 0 ? modalities : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextLimit ?? null,
        maxTokens: model.outputLimit ?? null,
      };
      stats.modelsAdded += 1;
      console.log(`  + ${slug}/${apiId}`);
    }
  }
  return stats;
}

async function main() {
  console.log("Fetching OMP catalog from upstream...");
  const catalog = await fetchJson(CATALOG_URL);
  const providerCount = Object.keys(catalog).length;
  let modelCount = 0;
  for (const models of Object.values(catalog)) {
    modelCount += Object.keys(models).length;
  }
  console.log(`  ${providerCount} providers, ${modelCount} models`);

  console.log(`Fetching basebuild.net desktop catalog (${BASEBUILD_BASE_URL})...`);
  try {
    const desktop = await fetchJson(`${BASEBUILD_BASE_URL}/api/catalog/desktop`);
    if (
      typeof desktop?.version !== "number" ||
      desktop.version > SUPPORTED_DESKTOP_CATALOG_VERSION
    ) {
      console.warn(
        `  skipping overlay: catalog version ${desktop?.version} > supported ${SUPPORTED_DESKTOP_CATALOG_VERSION}`,
      );
    } else {
      const stats = overlayBasebuildCatalog(catalog, desktop);
      console.log(
        `  overlay: +${stats.providersAdded} providers, +${stats.modelsAdded} models, ${stats.skipped} skipped`,
      );
    }
  } catch (err) {
    // Fail-soft: the OMP baseline update must still land.
    console.warn(`  warning: basebuild overlay skipped (${err.message})`);
  }

  // Deterministic serialization (stable key order from source objects, tab
  // indent like upstream) so repeated runs with identical data are no-ops.
  const catalogText = JSON.stringify(catalog, null, "\t") + "\n";

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
