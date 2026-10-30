#!/usr/bin/env node
/**
 * Localization checker for the Basebuild frontend.
 *
 * Enforces the i18n contract:
 *  1. No hard-coded user-facing English in src/components or src/App.tsx:
 *     JSX text, UI attributes (title, placeholder, aria-label, ...), and
 *     prose string branches inside JSX must go through t().
 *  2. Every t("key", { params }) call passes exactly the placeholders the
 *     English message declares.
 *  3. Every catalog key is referenced by a t() call or appears as a string literal in source (no dead keys).
 *  4. zh-CN and zh-TW cover the same keys as en, with the same {placeholders}.
 *  5. zh-TW matches what scripts/generate-zh-hant.mjs produces from zh-CN; run `npm run i18n:zh-hant` to regenerate.
 *
 * Exits 0 if clean, 1 if any violation is found.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { generateZhTW, ZH_TW_DIR } from "./generate-zh-hant.mjs";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const COMPONENTS = join(SRC, "components");
const APP_FILE = join(SRC, "App.tsx");
const STATE = join(SRC, "state");
const LIB_FILES = ["chatCommands.ts", "plans.ts"].map((f) => join(SRC, "lib", f));
const EN_DIR = join(SRC, "i18n", "en");
const ZH_DIR = join(SRC, "i18n", "zh-CN");

/** Attributes whose values are shown to the user. */
const UI_ATTRIBUTES = new Set([
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "alt",
  "label",
  "helperText",
  "tooltip",
]);

/** English prose: at least three letters in a row. Brand tokens are fine as long as they are catalog keys. */
const ENGLISH_WORD = /[A-Za-z]{3,}/;

let violations = 0;

function report(file, line, message) {
  violations += 1;
  console.error(`${relative(ROOT, file)}:${line}: ${message}`);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) out.push(path);
  }
  return out;
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** Literal leaves of a t() key argument: a string, or a ternary of strings. */
function keyLiterals(node) {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return keyLiterals(node.expression);
  if (ts.isConditionalExpression(node)) return [...keyLiterals(node.whenTrue), ...keyLiterals(node.whenFalse)];
  return [];
}

/** Returns the literal text of a string-like node, or null. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
  }
  return null;
}

const EXEMPT_MARKER = "i18n-exempt";
const BRAND_WORDS = new Set(["Basebuild", "OpenSpec", "Claude", "Codex", "Anthropic", "OpenAI", "GitHub", "Windows", "macOS", "Linux", "Markdown", "JSON", "OAuth", "MCP", "Tauri", "Ollama", "Gemini"]);
const COMPARISON_OPS = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);

/** Human-facing prose: two plain words, or one capitalized plain word that is not a brand. Identifiers, class lists, paths, and lowercase enum ids are not prose. */
function isUserProse(text) {
  const words = text
    .replace(/\$\{[^}]*\}|\{[^}]*\}/g, " ")
    .trim()
    .split(/\s+/)
    .filter((tok) => /^[A-Za-z][A-Za-z']*[.,:;!?\u2026]*$/.test(tok) && tok.replace(/[^A-Za-z]/g, "").length >= 3)
    .map((tok) => tok.replace(/[^A-Za-z]/g, ""));
  if (words.length >= 2) return true;
  return words.length === 1 && /^[A-Z]/.test(words[0]) && !BRAND_WORDS.has(words[0]);
}

/** Literals that are never displayed: import paths, type literals, object keys, comparisons, case labels, element keys, and logs. */
function isNonUserLiteral(node) {
  const p = node.parent;
  if (ts.isJsxAttribute(p) || ts.isLiteralTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isBinaryExpression(p) && COMPARISON_OPS.has(p.operatorToken.kind)) return true;
  if (ts.isCallExpression(p) && /^(addLog|log|console\.\w+)$/.test(p.expression.getText())) return true;
  return false;
}

function isProse(text) {
  return text !== null && ENGLISH_WORD.test(text) && /[A-Za-z]{3,}/.test(text.replace(/\$\{[^}]*\}/g, ""));
}

/** Attributes whose template values are classes, styles, keys, or URLs, not prose. */
const TEMPLATE_EXEMPT_ATTRS = /^(className|style|key|id|href|src|data-.*)$/;
/** Calls that take machine text: logs, DOM APIs, storage. */
const TEMPLATE_EXEMPT_CALLS = /^(addLog|log|console\.\w+|invoke|fetch|querySelectorAll?|classList\.\w+|setAttribute|getElementById|localStorage\.\w+|sessionStorage\.\w+)$/;
/** Static text with these characters is a path, selector, query, or markup, not prose. */
const TEMPLATE_CODE_CHARS = /[/=;&\\<>#]|:\/\//;
/** English word in template static text: three or more letters, bounded by space or punctuation. */
const TEMPLATE_ENGLISH_WORD = /(^|[\s,!?'"“”(])([A-Za-z]{3,})(?=$|[\s.,!?'"“”):;\u2026])/g;

/** Static text of a template literal, placeholders removed. */
function templateParts(node) {
  return ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)] : [node.text];
}

/** First English word in a template's static text, or null. All-caps acronyms are allowed. */
function englishTemplateWord(node) {
  const parts = templateParts(node);
  if (parts.some((p) => TEMPLATE_CODE_CHARS.test(p))) return null;
  for (const part of parts) {
    for (const m of part.matchAll(TEMPLATE_ENGLISH_WORD)) {
      if (!/^[A-Z]+$/.test(m[2])) return m[2];
    }
  }
  return null;
}

/** True when a template sits in a machine-facing position: class/style/key/URL attribute or a log, DOM, or storage call. */
function isMachineTemplate(node) {
  let cur = node.parent;
  for (let depth = 0; cur && depth < 4; depth += 1, cur = cur.parent) {
    if (ts.isJsxAttribute(cur) && TEMPLATE_EXEMPT_ATTRS.test(cur.name.getText())) return true;
    if (ts.isCallExpression(cur) && TEMPLATE_EXEMPT_CALLS.test(cur.expression.getText())) return true;
  }
  return false;
}

/** Collects UI-facing literals inside a JSX expression container: direct strings and ternary/logical branches. */
function collectBranchLiterals(expr, out) {
  if (!expr) return;
  if (ts.isParenthesizedExpression(expr)) return collectBranchLiterals(expr.expression, out);
  if (ts.isConditionalExpression(expr)) {
    collectBranchLiterals(expr.whenTrue, out);
    collectBranchLiterals(expr.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expr.operatorToken.kind)) {
    collectBranchLiterals(expr.right, out);
    return;
  }
  out.push(expr);
}

function checkFile(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const visit = (node) => {
    // 1a. JSX text with English prose.
    if (ts.isJsxText(node) && ENGLISH_WORD.test(node.text)) {
      report(file, lineOf(sf, node), `JSX text not localized: "${node.text.trim().slice(0, 80)}"`);
    }

    // 1b. UI attributes with literal or template values, or expression branches.
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && UI_ATTRIBUTES.has(node.name.text) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) && ENGLISH_WORD.test(init.text)) {
        report(file, lineOf(sf, node), `${node.name.text}="${init.text.slice(0, 80)}" not localized`);
      } else if (ts.isJsxExpression(init) && init.expression) {
        const branches = [];
        collectBranchLiterals(init.expression, branches);
        for (const branch of branches) {
          const value = literalText(branch);
          if (isProse(value)) report(file, lineOf(sf, branch), `${node.name.text} expression literal not localized: "${value.slice(0, 80)}"`);
        }
      }
    }

    // 1c. Prose string branches in JSX expression containers ({cond ? "Text" : ...}).
    if (ts.isJsxExpression(node) && node.expression && node.parent && !ts.isJsxAttribute(node.parent)) {
      const branches = [];
      collectBranchLiterals(node.expression, branches);
      for (const branch of branches) {
        const value = literalText(branch);
        if (isProse(value) && /\s/.test(value.trim())) {
          report(file, lineOf(sf, branch), `JSX expression literal not localized: "${value.slice(0, 80)}"`);
        }
      }
    }

    // 1d. Prose literals outside t(): toasts, labels, descriptions, state strings.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !isNonUserLiteral(node)) {
      const value = literalText(node);
      const line = lineOf(sf, node);
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exempt = [line - 2, line - 1, endLine - 1].some((i) => (lines[i] ?? "").includes(EXEMPT_MARKER));
      if (isUserProse(value) && !exempt) report(file, line, `hard-coded prose: "${value.slice(0, 80)}"`);
    }

    // 1e. Template literals with English static text (e.g. `${n}m ago`) outside machine-facing positions.
    if ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isNonUserLiteral(node) && !isMachineTemplate(node)) {
      const line = lineOf(sf, node);
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exempt = [line - 2, line - 1, endLine - 1].some((i) => (lines[i] ?? "").includes(EXEMPT_MARKER));
      const value = literalText(node);
      const word = englishTemplateWord(node);
      if (word && !exempt && !isUserProse(value)) report(file, line, `template literal with English text "${word}": "${value.slice(0, 80)}"`);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/** Parses `"key": "value",` lines from a catalog file. */
function parseCatalog(dir) {
  const entries = new Map();
  for (const name of readdirSync(dir)) {
    if (name === "index.ts") continue;
    const text = readFileSync(join(dir, name), "utf8");
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name)) && ts.isStringLiteral(node.initializer)) {
        const key = ts.isStringLiteral(node.name) ? node.name.text : node.name.text;
        entries.set(key, { value: node.initializer.text, file: join(dir, name) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return entries;
}

function placeholdersOf(value) {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

const en = parseCatalog(EN_DIR);
const locales = [
  { name: "zh-CN", dir: ZH_DIR, catalog: parseCatalog(ZH_DIR) },
  { name: "zh-TW", dir: ZH_TW_DIR, catalog: parseCatalog(ZH_TW_DIR) },
];

// 4. Key and placeholder parity.
for (const { name, dir, catalog } of locales) {
  for (const key of en.keys()) {
    if (!catalog.has(key)) report(join(dir, "index.ts"), 1, `${name} is missing key "${key}"`);
  }
  for (const key of catalog.keys()) {
    if (!en.has(key)) report(join(EN_DIR, "index.ts"), 1, `${name} has key "${key}" that en does not`);
  }
  for (const [key, entry] of catalog) {
    if (!en.has(key)) continue;
    const want = [...placeholdersOf(en.get(key).value)].sort().join(",");
    const got = [...placeholdersOf(entry.value)].sort().join(",");
    if (want !== got) report(entry.file, 1, `${name} placeholders for "${key}" are {${got}}, en has {${want}}`);
  }
}

// 5. zh-TW is generated from zh-CN; the committed files must match the generator.
const generated = generateZhTW();
for (const [name, content] of generated) {
  const path = join(ZH_TW_DIR, name);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current !== content) report(path, 1, "zh-TW is stale; run `npm run i18n:zh-hant`");
}
for (const name of readdirSync(ZH_TW_DIR)) {
  if (!generated.has(name)) report(join(ZH_TW_DIR, name), 1, "zh-TW has a file the generator does not produce; run `npm run i18n:zh-hant`");
}

// 2 and 3: call sites.
const usedKeys = new Set();
const sourceFiles = [...walk(COMPONENTS), ...walk(STATE), ...LIB_FILES, APP_FILE];
for (const file of sourceFiles) {
  checkFile(file);
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length >= 1) {
      const keyArg = node.arguments[0];
      for (const key of keyLiterals(keyArg)) {
        usedKeys.add(key);
        const entry = en.get(key);
        if (!entry) {
          report(file, lineOf(sf, node), `t("${key}") has no English catalog entry`);
        } else {
          const expected = placeholdersOf(entry.value);
          const passed = new Set();
          if (node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
            for (const prop of node.arguments[1].properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) passed.add(prop.name.text);
              else if (ts.isShorthandPropertyAssignment(prop)) passed.add(prop.name.text);
            }
          }
          const missing = [...expected].filter((p) => !passed.has(p));
          const extra = [...passed].filter((p) => !expected.has(p));
          if (missing.length || extra.length) {
            report(file, lineOf(sf, node), `t("${key}") params mismatch: missing [${missing.join(", ")}] extra [${extra.join(", ")}]`);
          }
        }
      }
    }
    // Keys held in lookup maps (e.g. const KEYS = { idle: "x.idle" }) are referenced by string literal.
    if (ts.isStringLiteral(node) && en.has(node.text)) usedKeys.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const key of en.keys()) {
  if (!usedKeys.has(key)) report(en.get(key).file, 1, `unused catalog key "${key}"`);
}

if (violations > 0) {
  console.error(`\ncheck-i18n: ${violations} violation(s)`);
  process.exit(1);
}
console.log(`check-i18n: ${en.size} keys, ${usedKeys.size} referenced, no violations`);
