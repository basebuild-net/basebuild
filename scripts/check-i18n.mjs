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
 *  3. Every catalog key is referenced by at least one t() call (no dead keys).
 *  4. zh-CN covers the same keys as en (also enforced by the type system).
 *
 * Exits 0 if clean, 1 if any violation is found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const COMPONENTS = join(SRC, "components");
const APP_FILE = join(SRC, "App.tsx");
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

function isProse(text) {
  return text !== null && ENGLISH_WORD.test(text) && /[A-Za-z]{3,}/.test(text.replace(/\$\{[^}]*\}/g, ""));
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
const zh = parseCatalog(ZH_DIR);

// 4. Key parity.
for (const key of en.keys()) {
  if (!zh.has(key)) report(join(ZH_DIR, "index.ts"), 1, `zh-CN is missing key "${key}"`);
}
for (const key of zh.keys()) {
  if (!en.has(key)) report(join(EN_DIR, "index.ts"), 1, `zh-CN has key "${key}" that en does not`);
}

// 2 and 3: call sites.
const usedKeys = new Set();
const sourceFiles = [...walk(COMPONENTS), APP_FILE];
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
