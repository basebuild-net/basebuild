import { expect, test } from "@playwright/test";

test.describe("markdown lexer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("highlightCode reassembles losslessly and preserves line order", async ({ page }) => {
    const fixtures = {
      ts: "const x = 1;\n// line comment\nconst y = 2;",
      py: "x = 1\n# line comment\ny = 2",
      mixed: 'const url = "http://example.com"; // not a comment\nconst hash = "#tag";\n/* block */\nconst n = 3.14;\n',
    };

    const result = await page.evaluate(async (input) => {
      // Dynamic import runs in the browser context via the Vite dev server;
      // a static import would resolve in the Playwright/Node process instead.
      const mod = (await import("/src/lib/markdown.ts")) as {
        highlightCode: (content: string, lang: string) => Array<{ text: string; cls: string }>;
      };
      const tsTokens = mod.highlightCode(input.ts, "ts");
      const pyTokens = mod.highlightCode(input.py, "py");
      const mixedTokens = mod.highlightCode(input.mixed, "ts");
      return {
        tsReassembled: tsTokens.map((t) => t.text).join(""),
        tsFirstText: tsTokens[0]?.text,
        pyReassembled: pyTokens.map((t) => t.text).join(""),
        mixedReassembled: mixedTokens.map((t) => t.text).join(""),
      };
    }, fixtures);
    expect(result.tsReassembled).toBe(fixtures.ts);
    expect(result.pyReassembled).toBe(fixtures.py);
    expect(result.mixedReassembled).toBe(fixtures.mixed);
    expect(result.tsFirstText).toBe("const");
    expect(result.tsReassembled.startsWith("const x")).toBe(true);
  });

  test("parseInline blocks dangerous link schemes and allows safe ones", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mod = (await import("/src/lib/markdown.ts")) as {
        parseInline: (text: string) => Array<{ kind: string }>;
      };
      return {
        jsKinds: mod.parseInline("[click](javascript:alert(1))").map((n) => n.kind),
        dataKinds: mod.parseInline("[d](data:text/html,x)").map((n) => n.kind),
        httpsKinds: mod.parseInline("[ok](https://example.com)").map((n) => n.kind),
        relKinds: mod.parseInline("[rel](docs/readme.md)").map((n) => n.kind),
      };
    });

    expect(result.jsKinds).not.toContain("link");
    expect(result.dataKinds).not.toContain("link");
    expect(result.httpsKinds).toEqual(["link"]);
    expect(result.relKinds).toEqual(["link"]);
  });

  test("parseInline round-trips inline markers", async ({ page }) => {
    const text = "plain **bold** and `code` here";
    const kinds = await page.evaluate(async (t) => {
      const mod = (await import("/src/lib/markdown.ts")) as {
        parseInline: (text: string) => Array<{ kind: string }>;
      };
      return mod.parseInline(t).map((n) => n.kind);
    }, text);

    expect(kinds).toEqual(["text", "bold", "text", "code", "text"]);
  });
});
