import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCatalogShape,
  assertNoCatalogCollapse,
  carryForwardProviders,
  decodeOhMyPiCatalog,
  overlayModelsDevCatalog,
} from "./update-model-catalog.mjs";

// keys: 0 name, 1 api, 2 baseUrl, 3 reasoning, 4 input, 5 cost, 6 input$, 7 supportsTools, 8 strict
const compact = {
  version: 1,
  keys: ["name", "api", "baseUrl", "reasoning", "input", "cost", "input$", "supportsTools", "strict"],
  booleanShapes: [[], [3], [7, 8]],
  nodes: [
    [0, [1, "openai-completions", 2, "https://api.example.com/v1"], 0, []], // 0: provider constants
    [1, ["text", "image"]], // 1: shared input array
    [0, [6, 2.5], 0, []], // 2: cost object
    [0, [0, "Model A", 4, [1], 5, [2]], 1, [1]], // 3: model A, reasoning true
    [0, [0, "Model B", 4, [1]], 1, [0]], // 4: model B, reasoning false
    [0, [], 2, [1]], // 5: compat base, supportsTools true, strict false
    [0, [], 0, []], // 6: empty compat change
  ],
  compat: [["openai-completions", [5]]],
  providers: [["example", [0], [["a", [3]], ["b", [4], [[8], [6]]]]]],
};

test("decodes the compact OhMyPi encoding into the provider/model map", () => {
  const catalog = decodeOhMyPiCatalog(compact);
  assert.deepEqual(catalog.example.a, {
    id: "a",
    api: "openai-completions",
    baseUrl: "https://api.example.com/v1",
    name: "Model A",
    input: ["text", "image"],
    cost: { input$: 2.5 },
    reasoning: true,
  });
  assert.equal(catalog.example.b.reasoning, false);
  // Compat delta: base minus removed key `strict`.
  assert.deepEqual(catalog.example.b.compat, { supportsTools: true });
  assertCatalogShape(catalog);
});

test("decoded models do not share mutable nested values", () => {
  const catalog = decodeOhMyPiCatalog(compact);
  catalog.example.a.input.push("audio");
  assert.deepEqual(catalog.example.b.input, ["text", "image"]);
});

test("map-shaped catalogs pass through and malformed ones are rejected", () => {
  const map = { p: { m: { id: "m", api: "openai-completions" } } };
  assert.equal(decodeOhMyPiCatalog(map), map);
  assert.throws(() => assertCatalogShape({ version: 1, nodes: [] }), /not a model map/);
});

function catalogOf(providers, modelsEach) {
  const catalog = {};
  for (let p = 0; p < providers; p++) {
    catalog[`p${p}`] = {};
    for (let m = 0; m < modelsEach; m++) catalog[`p${p}`][`m${m}`] = { id: `m${m}`, api: "openai-completions" };
  }
  return catalog;
}

test("a refresh may lose up to 10% of providers or models, not more", () => {
  const bundled = catalogOf(20, 10);
  assert.doesNotThrow(() => assertNoCatalogCollapse(bundled, catalogOf(18, 10)));
  assert.doesNotThrow(() => assertNoCatalogCollapse(bundled, catalogOf(25, 10)));
  assert.throws(() => assertNoCatalogCollapse(bundled, catalogOf(17, 10)), /providers would drop from 20 to 17/);
  // Providers intact, models gutted (the upstream format change that shipped 2 Devin models).
  assert.throws(() => assertNoCatalogCollapse(bundled, catalogOf(20, 8)), /models would drop from 200 to 160/);
});

test("models.dev adds connectable providers and missing models, never overwriting existing rows", () => {
  const existing = { id: "kept", name: "Kept", api: "anthropic-messages", provider: "known", baseUrl: "https://known.test", reasoning: true, input: ["text"], cost: { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1, maxTokens: 1 };
  const catalog = { known: { kept: existing } };
  const stats = overlayModelsDevCatalog(catalog, {
    known: { models: { kept: { name: "Overwrite attempt" }, extra: { name: "Extra" } } },
    compat: {
      npm: "@ai-sdk/openai-compatible",
      api: "https://compat.test/v1",
      models: {
        m: { name: "M", reasoning: true, modalities: { input: ["text", "image"], output: ["text"] }, cost: { input: 1.5, output: 3, cache_read: 0.1 }, limit: { context: 200000, output: 8000 } },
      },
    },
    "no-route": { npm: "custom-sdk", models: { x: { name: "X" } } },
  });

  assert.deepEqual(stats, { providersAdded: 1, modelsAdded: 2, skipped: 1 });
  assert.equal(catalog.known.kept, existing);
  assert.equal(catalog.known.extra.api, "anthropic-messages");
  assert.equal(catalog.known.extra.baseUrl, "https://known.test");
  assert.deepEqual(catalog.compat.m, {
    id: "m",
    name: "M",
    api: "openai-completions",
    provider: "compat",
    baseUrl: "https://compat.test/v1",
    reasoning: true,
    input: ["text", "image"],
    output: ["text"],
    cost: { input: 1.5, output: 3, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8000,
  });
  assert.equal(catalog["no-route"], undefined);
  assert.doesNotThrow(() => assertCatalogShape(catalog));
});

test("missing models and providers survive refresh while fresh entries take precedence", () => {
  const fresh = { a: { m1: { id: "m1", api: "fresh" } } };
  const previous = {
    a: { m1: { id: "m1", api: "old" }, old: { id: "old", api: "openai-completions" } },
    b: { m2: { id: "m2", api: "openai-completions" } },
  };
  assert.deepEqual(carryForwardProviders(fresh, previous), { providers: 1, models: 2 });
  assert.equal(fresh.a.m1.api, "fresh");
  assert.deepEqual(fresh.a.old, previous.a.old);
  assert.deepEqual(fresh.b, previous.b);
});
