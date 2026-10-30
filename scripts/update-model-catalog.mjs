#!/usr/bin/env node
// Refreshes Basebuild's first-party model catalog (src-tauri/catalog/models.json):
//
//   1. Pulls OhMyPi's catalog (baseline: providers, models, wire protocol
//      kinds, base URLs, costs).
//   2. Overlays the basebuild.net desktop catalog (GET /api/catalog/desktop)
//      so models that launched upstream of OhMyPi — or that only basebuild
//      tracks — are present in the bundled file with enough information to
//      connect (provider slug, model API id, wire kind, base URL).
//   3. Overlays Basebuild's first-party voice facts (catalog/voice-overlay.json)
//      so realtime/TTS routes keep their `voice` block and audio modalities
//      when upstream drops them. Upstream carried this data until it did not,
//      and a silent loss turns a working voice route into a text-only model.
//   4. Writes a deterministic serialization and stamps a content-hash VERSION
//      used by the cache-invalidation logic in provider_model_catalog_service.
//
// The basebuild overlay is fail-soft: if basebuild.net is unreachable the
// OhMyPi baseline still updates. Overlay entries are additive only — they never
// overwrite an existing OhMyPi entry (preserving its cost/metadata).
//
// Usage: node scripts/update-model-catalog.mjs
// Env:   BASEBUILD_CATALOG_URL overrides https://basebuild.net (dev/testing).

import { createHash } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = resolve(__dirname, "../src-tauri/catalog");
const OHMYPI_CATALOG_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/refs/heads/main/packages/catalog/src/models.json";
const OHMYPI_LICENSE_URL =
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
 * Overlay basebuild.net's desktop catalog onto the OhMyPi baseline. Adds only
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

/**
 * Overlay Basebuild's first-party voice facts onto the catalog. `voice` is
 * authoritative — these blocks are curated against each provider's published
 * realtime contract and back invariant tests in `models/model_catalog.rs` —
 * while `input`/`output` modalities are unioned so an upstream modality we do
 * not track is never dropped. Entries for models absent from the catalog are
 * skipped, not injected: an overlay row alone does not make a route reachable.
 *
 * Mutates `catalog`; returns { applied, missing }.
 */
function applyVoiceOverlay(catalog, overlay) {
  const stats = { applied: 0, missing: [] };
  for (const [slug, models] of Object.entries(overlay)) {
    for (const [id, patch] of Object.entries(models)) {
      const model = catalog[slug]?.[id];
      if (!model || typeof model !== "object") {
        stats.missing.push(`${slug}/${id}`);
        continue;
      }
      for (const field of ["input", "output"]) {
        const merged = new Set([...(model[field] ?? []), ...(patch[field] ?? [])]);
        if (merged.size > 0) model[field] = [...merged];
      }
      model.voice = patch.voice;
      stats.applied += 1;
    }
  }
  return stats;
}

/**
 * OhMyPi publishes models.json in a compact, hash-consed encoding
 * (`{version: 1, keys, booleanShapes, nodes, compat, providers}`; see
 * packages/catalog/src/model-catalog-format.ts upstream). Basebuild's Rust
 * parser reads the plain `provider -> model id -> model` map, so decode here.
 * A map-shaped input (the older upstream format) passes through unchanged.
 */
export function decodeOhMyPiCatalog(raw) {
  if (!(raw && raw.version === 1 && Array.isArray(raw.nodes) && Array.isArray(raw.providers))) {
    return raw;
  }
  const { keys, booleanShapes, nodes } = raw;
  const compatBases = new Map(raw.compat);
  const values = new Map();
  const set = (object, key, value) => {
    if (value === undefined) return;
    if (key === "__proto__") {
      Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
    } else {
      object[key] = value;
    }
  };
  const decodeObject = (object, node) => {
    for (let i = 0; i < node[1].length; i += 2) set(object, keys[node[1][i]], decode(node[1][i + 1]));
    const shape = booleanShapes[node[2]];
    for (let i = 0; i < shape.length; i++) {
      set(object, keys[shape[i]], ((node[3][i >>> 5] >>> (i % 32)) & 1) !== 0);
    }
  };
  // Decoded values are cloned per use so later overlays can mutate one model
  // without touching every model that shared the interned node.
  const decode = (value) => {
    if (!Array.isArray(value)) return value;
    const id = value[0];
    if (id === -1) return undefined;
    if (!values.has(id)) {
      const node = nodes[id];
      if (!node) throw new Error(`compact catalog: missing node ${id}`);
      let result;
      if (node[0] === 1) {
        result = node[1].map((entry) => decode(entry));
      } else {
        result = {};
        decodeObject(result, node);
      }
      values.set(id, result);
    }
    return structuredClone(values.get(id));
  };
  const catalog = {};
  for (const [provider, encodedConstants, rows] of raw.providers) {
    const constants = decode(encodedConstants) ?? {};
    const models = {};
    for (const [id, encoded, delta] of rows) {
      if (!Array.isArray(encoded) || encoded[0] < 0 || nodes[encoded[0]]?.[0] !== 0) {
        throw new Error(`compact catalog: invalid model row ${provider}/${id}`);
      }
      const model = { id, ...structuredClone(constants) };
      decodeObject(model, nodes[encoded[0]]);
      if (delta) {
        const compat = decode(compatBases.get(model.api)) ?? {};
        for (const key of delta[0]) delete compat[keys[key]];
        const changes = decode(delta[1]) ?? {};
        for (const key of Object.keys(changes)) set(compat, key, changes[key]);
        model.compat = compat;
      }
      set(models, id, model);
    }
    catalog[provider] = models;
  }
  return catalog;
}

/** Fail before writing if the catalog is not the map shape model_catalog.rs parses. */
export function assertCatalogShape(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("catalog: expected an object of providers");
  }
  let models = 0;
  for (const [provider, entries] of Object.entries(catalog)) {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      throw new Error(`catalog: provider '${provider}' is not a model map`);
    }
    for (const [id, model] of Object.entries(entries)) {
      if (!model || typeof model !== "object" || typeof model.id !== "string" || typeof model.api !== "string") {
        throw new Error(`catalog: model '${provider}/${id}' lacks id/api`);
      }
      models += 1;
    }
  }
  if (models === 0) throw new Error("catalog: no models");
}

async function main() {
  console.log("Fetching OhMyPi catalog from upstream...");
  const catalog = decodeOhMyPiCatalog(await fetchJson(OHMYPI_CATALOG_URL));
  assertCatalogShape(catalog);
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
    // Fail-soft: the OhMyPi baseline update must still land.
    console.warn(`  warning: basebuild overlay skipped (${err.message})`);
  }

  console.log("Applying first-party voice overlay...");
  const voiceOverlay = JSON.parse(
    await readFile(resolve(CATALOG_DIR, "voice-overlay.json"), "utf8"),
  );
  const voiceStats = applyVoiceOverlay(catalog, voiceOverlay);
  console.log(`  voice: ${voiceStats.applied} models patched`);
  if (voiceStats.missing.length > 0) {
    // Not fatal — a model can legitimately leave the catalog — but the stale
    // overlay row should be pruned rather than left to rot.
    console.warn(`  warning: overlay rows with no catalog model: ${voiceStats.missing.join(", ")}`);
  }

  // Deterministic serialization (stable key order from source objects, tab
  // indent like upstream) so repeated runs with identical data are no-ops.
  assertCatalogShape(catalog);
  const catalogText = JSON.stringify(catalog, null, "\t") + "\n";

  // Content-hash version stamp (SHA-256 of the canonical JSON, first 16 hex chars).
  const version = createHash("sha256").update(catalogText).digest("hex").slice(0, 16);
  console.log(`  catalog version: ${version}`);

  await mkdir(CATALOG_DIR, { recursive: true });
  await writeFile(resolve(CATALOG_DIR, "models.json"), catalogText, "utf8");
  await writeFile(resolve(CATALOG_DIR, "VERSION"), version + "\n", "utf8");

  console.log("Fetching OhMyPi attribution license...");
  const licenseResponse = await fetch(OHMYPI_LICENSE_URL);
  if (licenseResponse.ok) {
    await writeFile(resolve(CATALOG_DIR, "LICENSE.md"), await licenseResponse.text(), "utf8");
  } else {
    console.warn(`  warning: could not fetch OhMyPi license (${licenseResponse.status})`);
  }

  console.log("Done. Review the diff before committing.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
