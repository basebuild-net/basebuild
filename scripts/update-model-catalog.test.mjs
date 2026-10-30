import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCatalogShape, decodeOhMyPiCatalog } from "./update-model-catalog.mjs";

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
