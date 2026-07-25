#!/usr/bin/env node
/**
 * UI invariant checker for the Basebuild frontend.
 *
 * Enforces project conventions:
 *  1. Only one stylesheet: src/styles/globals.css (no CSS modules, no extra .css files).
 *  2. No inline `style={{ ... }}` in components (dynamic values are exempt —
 *     width/height/transform that depend on runtime state).
 *  3. No non-zero `border-radius` in globals.css.
 *  4. Interactive elements (`<button>`, `<a>`, `<select>`, `<input>`) should have
 *     a `title=` attribute (tooltip).
 *  5. A `state/` hook that fetches on mount must initialise its loading flag to
 *     `true`. `useState(false)` renders the empty branch on the first commit,
 *     before the effect has run — invisible on a fast machine, a visible lie on
 *     a slow one. See docs/agents/design-system.md#loading-states.
 *  6. Every `<Suspense>` must carry a non-null `fallback`.
 *
 * Exits 0 if all invariants pass, 1 if any violations are found.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

let violations = 0;

function fail(file, line, message) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  console.error(`  ✗ ${rel}:${line}  ${message}`);
  violations++;
}

/** 1. Check for extra stylesheets beyond globals.css. */
function checkStylesheets() {
  console.log("Checking for extra stylesheets...");
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".css") {
        const rel = relative(SRC, full).replace(/\\/g, "/");
        if (rel !== "styles/globals.css") {
          fail(full, 0, `Extra stylesheet found: ${rel} — only src/styles/globals.css is allowed`);
        }
      }
    }
  }
  walk(SRC);
}

/** 2. Check for inline styles in .tsx files. */
function checkInlineStyles() {
  console.log("Checking for inline styles in components...");
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".tsx") {
        const content = readFileSync(full, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match style={{ ... }} — allow dynamic width/height/transform (progress bars, splitters).
          const match = line.match(/style=\{\{/);
          if (match) {
            // Check if this is a dynamic value (width: `${...}%`, flex values, etc.)
            const styleContent = line.slice(match.index);
            const isDynamicWidth = /width:\s*`?\$\{/.test(styleContent) || /width:\s*`\$\{/.test(styleContent);
            const isDynamicFlex = /flexBasis:\s*[^"'`]/.test(styleContent) && !/flexBasis:\s*"/.test(styleContent);
            const isDynamicTransform = /transform:\s*`?\$\{/.test(styleContent);
            const isDynamicGridRow = /height:\s*\{/.test(styleContent) && /ROW_H/.test(styleContent);

            // Allow dynamic positioning for popovers (top/left from state)
            const isDynamicPosition = /top:\s*(?:position|dropdownPos|popoverPos)/.test(styleContent) ||
              /left:\s*(?:position|dropdownPos|popoverPos)/.test(styleContent);

            if (!isDynamicWidth && !isDynamicFlex && !isDynamicTransform && !isDynamicGridRow && !isDynamicPosition) {
              // Check the full style block for static-only values
              const fullStyleMatch = styleContent.match(/style=\{\{([^}]*(?:\}[^}]*?)*)\}\}/);
              if (fullStyleMatch) {
                const styleBody = fullStyleMatch[1];
                // If the style body contains only static values (no ${...} template literals)
                if (!/\$\{/.test(styleBody)) {
                  fail(full, i + 1, "Static inline style — move to globals.css class");
                }
              }
            }
          }
        }
      }
    }
  }
  walk(SRC);
}

/** 3. Check for non-zero border-radius in globals.css. */
function checkBorderRadius() {
  console.log("Checking for non-zero border-radius in globals.css...");
  const cssPath = join(SRC, "styles", "globals.css");
  const content = readFileSync(cssPath, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("/*") || line.trim().startsWith("*")) continue;
    // Find all border-radius declarations in the line
    const re = /border-radius:\s*([^;]+)/gi;
    let m;
    while ((m = re.exec(line)) !== null) {
      const value = m[1].trim();
      // Allow 0, 0px, 0rem, 0em
      // Allow 0, 0px, 0rem, 0em, and var(--bb-radius-*) tokens
      if (!/^0(?:px|rem|em)?$/.test(value) && !/^var\(--bb-radius-/.test(value)) {
        fail(cssPath, i + 1, `Non-zero border-radius: ${value} in: ${line.trim()}`);
      }
    }
  }
}

/**
 * Determine whether a position on a line falls inside a comment.
 * Handles line comments (//) and block comments (/* *​/).
 * `inBlockComment` is the state carried from previous lines.
 */
function isInsideComment(line, index, inBlockComment) {
  if (inBlockComment) {
    // If the block comment closes before the tag, the tag is not in a comment.
    const closeIdx = line.indexOf("*/");
    return closeIdx === -1 || closeIdx >= index;
  }
  // Check for a line comment (//) before the tag position.
  const lineCommentIdx = line.indexOf("//");
  return lineCommentIdx !== -1 && lineCommentIdx < index;
}

/**
 * Update the block-comment state after processing a line.
 * Toggles on /* and off on *​/ , handling multiple pairs per line.
 */
function updateBlockCommentState(line, inBlockComment) {
  let state = inBlockComment;
  for (let i = 0; i < line.length; i++) {
    if (state) {
      if (line[i] === "*" && line[i + 1] === "/") { state = false; i++; }
    } else {
      if (line[i] === "/" && line[i + 1] === "*") { state = true; i++; }
      else if (line[i] === "/" && line[i + 1] === "/") { break; } // rest is a line comment
    }
  }
  return state;
}
/** 4. Check interactive elements without title= attribute. */
function checkTooltips() {
  console.log("Checking for interactive elements without title=...");
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (extname(entry) === ".tsx") {
        const content = readFileSync(full, "utf8");
        const lines = content.split("\n");
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Check <button, <a, <select, <input tags for missing title=
          // Only check opening tags — skip closing tags and self-closing refs
          const tagMatch = line.match(/<(button|a|select|input)\b[^>]*>/g);
          if (!tagMatch) {
            // Still need to track block comment state even on non-matching lines.
            inBlockComment = updateBlockCommentState(line, inBlockComment);
            continue;
          }

          for (const tag of tagMatch) {
            // Skip if it's a closing tag
            if (tag.startsWith("</")) continue;
            // Skip if the tag has title= or aria-label= (aria-label is acceptable for screen readers)
            if (/\btitle=/.test(tag) || /\baria-label=/.test(tag)) continue;
            // Skip type="hidden" inputs
            if (/type=["']hidden["']/.test(tag)) continue;
            // Skip inputs inside test-support
            if (full.includes("test-support")) continue;
            // Skip tags inside comments (line comments or block comments).
            // Prevents false positives like `/// replaces native <select>`.
            const tagIndex = line.indexOf(tag);
            if (isInsideComment(line, tagIndex, inBlockComment)) continue;
            // Skip if it's a self-closing tag with no interactive behavior (like <input type="checkbox" />)
            // Actually, checkboxes are interactive — but they often have title on the <label>
            // For now, flag all without title= or aria-label=
            fail(full, i + 1, `Interactive <${tag.match(/<(\w+)/)[1]}> without title= or aria-label=`);
          }
          inBlockComment = updateBlockCommentState(line, inBlockComment);
        }
      }
    }
  }
  // Only check components/ directory, not test-support/
  walk(join(SRC, "components"));
}

/**
 * 5. Loading flags in `src/state/` must start `true` when the hook fetches on
 * mount. A `useState(false)` loading flag paired with a mount effect means the
 * first commit renders the empty state.
 */
function checkLoadingFlags() {
  console.log("Checking state hooks initialise loading flags to true...");
  const dir = join(SRC, "state");
  for (const entry of readdirSync(dir)) {
    if (![".ts", ".tsx"].includes(extname(entry))) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) continue;
    const content = readFileSync(full, "utf8");
    // Only hooks that actually fetch on mount can have this bug.
    if (!/useEffect\(/.test(content) || !/\bawait\b/.test(content)) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(
        /const\s*\[\s*(\w*[lL]oading\w*)\s*,\s*set\w+\s*\]\s*=\s*useState(?:<[^>]*>)?\(\s*false\s*\)/,
      );
      if (match) {
        fail(
          full,
          i + 1,
          `Loading flag "${match[1]}" starts false — the first commit renders the empty state. Initialise it true.`,
        );
      }
    }
  }
}

/** 6. Every `<Suspense>` must pass a non-null `fallback`. */
function checkSuspenseFallbacks() {
  console.log("Checking Suspense boundaries declare a fallback...");
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "test-support") walk(full);
        continue;
      }
      if (extname(entry) !== ".tsx") continue;
      const content = readFileSync(full, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/<Suspense\b/.test(lines[i])) continue;
        // The fallback may wrap onto the next couple of lines.
        const window = lines.slice(i, i + 3).join(" ");
        if (!/fallback=/.test(window)) {
          fail(full, i + 1, "Suspense without a fallback — a blank surface looks broken");
        } else if (/fallback=\{\s*null\s*\}/.test(window)) {
          fail(full, i + 1, "Suspense fallback={null} — render a loading state instead");
        }
      }
    }
  }
  walk(SRC);
}

// Run all checks
console.log("Running UI invariant checks...\n");
checkStylesheets();
checkInlineStyles();
checkBorderRadius();
checkTooltips();
checkLoadingFlags();
checkSuspenseFallbacks();

console.log(`\n${violations === 0 ? "✓ All UI invariants pass" : `✗ ${violations} invariant violation(s) found`}`);
process.exit(violations === 0 ? 0 : 1);
