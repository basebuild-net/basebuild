// In-house markdown tokenizer → typed AST.
// Emits React-friendly block/inline nodes; MarkdownView.tsx renders them.
// Security: never produces HTML strings. Raw HTML in source → literal text.
// Streaming-safe: single-pass O(n), never throws, unterminated fence = code-to-end.

// ─── Block types ───────────────────────────────────────────────────────────

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: MdInline[] }
  | { kind: "italic"; children: MdInline[] }
  | { kind: "link"; label: string; url: string };

export type MdBlock =
  | { kind: "fence"; lang: string; content: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "blockquote"; children: MdInline[] }
  | { kind: "list"; ordered: boolean; items: MdInline[][] }
  | { kind: "table"; headers: MdInline[][]; rows: MdInline[][][] }
  | { kind: "hr" };

// ─── Block tokenizer ───────────────────────────────────────────────────────

export function parseMarkdown(text: string): MdBlock[] {
  if (!text) return [];
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fence: ``` or ~~~ (with optional language tag).
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})\s*(.*)$/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      const lang = fenceMatch[3].trim();
      const contentLines: string[] = [];
      i++;
      // Read until matching closing fence or end of input (streaming-safe).
      while (i < lines.length) {
        const next = lines[i];
        const closeMatch = next.match(/^\s{0,3}([`~]+)\s*$/);
        if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
          i++;
          break;
        }
        contentLines.push(next);
        i++;
      }
      blocks.push({ kind: "fence", lang, content: contentLines.join("\n") });
      continue;
    }

    // Horizontal rule: ---, ***, ___ (3+ chars, only spaces between).
    if (/^\s{0,3}([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    // Heading: 1-6 `#` + space + text.
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, children: parseInline(headingMatch[2].trim()) });
      i++;
      continue;
    }

    // Blockquote: `> ` prefix (collect consecutive lines).
    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "blockquote", children: parseInline(quoteLines.join(" ")) });
      continue;
    }

    // Table: a line with `|`, followed by a separator line `---|---`.
    if (line.includes("|") && i + 1 < lines.length && /^\s{0,3}\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const tableResult = tryParseTable(lines, i);
      if (tableResult) {
        blocks.push(tableResult.block);
        i = tableResult.nextI;
        continue;
      }
    }

    // Ordered list: `1. ` or `1) ` prefix.
    if (/^\s{0,3}\d+[.)]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s{0,3}\d+[.)]\s+/, "");
        // Collect continuation lines (indented, non-blank, not a new list item).
        i++;
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !/^\s{0,3}\d+[.)]\s+/.test(lines[i]) &&
          !/^\s{0,3}[-*+]\s+/.test(lines[i]) &&
          /^\s{4,}/.test(lines[i])
        ) {
          i++;
        }
        items.push(parseInline(itemText));
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    // Unordered list: `- `, `* `, or `+ ` prefix.
    if (/^\s{0,3}[-*+]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s{0,3}[-*+]\s+/, "");
        i++;
        // Continuation: indented non-blank, not a new item.
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          !/^\s{0,3}[-*+]\s+/.test(lines[i]) &&
          !/^\s{0,3}\d+[.)]\s+/.test(lines[i]) &&
          /^\s{4,}/.test(lines[i])
        ) {
          i++;
        }
        items.push(parseInline(itemText));
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s{0,3}(`{3,}|~{3,})/.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[i]) &&
      !/^\s{0,3}>\s?/.test(lines[i]) &&
      !/^\s{0,3}([-*_])\1{2,}\s*$/.test(lines[i]) &&
      !/^\s{0,3}[-*+]\s+/.test(lines[i]) &&
      !/^\s{0,3}\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: "paragraph", children: parseInline(paraLines.join(" ")) });
    }
  }

  return blocks;
}

// ─── Table parser ──────────────────────────────────────────────────────────

type TableParseResult = { block: MdBlock; nextI: number };

function tryParseTable(lines: string[], start: number): TableParseResult | null {
  // Header row must have at least one pipe (or leading/trailing pipe).
  const headerLine = lines[start];
  const separatorLine = lines[start + 1];

  // Separator must contain at least one dash and only dashes, colons, pipes, spaces.
  if (!/[\s:|-]*-[\s:|-]*/.test(separatorLine)) return null;

  const splitRow = (row: string): string[] => {
    const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => c.trim());
  };

  const headerCells = splitRow(headerLine);
  const sepCells = splitRow(separatorLine);
  if (headerCells.length !== sepCells.length) return null;

  const headers = headerCells.map((c) => parseInline(c));
  const rows: MdInline[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
    const cells = splitRow(lines[i]);
    // Pad/truncate to header width.
    while (cells.length < headerCells.length) cells.push("");
    rows.push(cells.slice(0, headerCells.length).map((c) => parseInline(c)));
    i++;
  }

  return {
    block: { kind: "table", headers, rows },
    nextI: i,
  };
}

// ─── Inline tokenizer ──────────────────────────────────────────────────────

export function parseInline(text: string): MdInline[] {
  if (!text) return [];
  const nodes: MdInline[] = [];
  let pos = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      nodes.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (pos < text.length) {
    const remaining = text.slice(pos);

    // Inline code: `code` or ``code with ` inside``.
    const codeMatch = remaining.match(/^(`+)([\s\S]*?[^`])\1(?!`)/);
    if (codeMatch) {
      flush();
      nodes.push({ kind: "code", text: codeMatch[2] });
      pos += codeMatch[0].length;
      continue;
    }

    // Bold: **text** or __text__.
    const boldMatch = remaining.match(/^\*\*([^*]+?)\*\*(?!\*)/);
    if (boldMatch) {
      flush();
      nodes.push({ kind: "bold", children: parseInline(boldMatch[1]) });
      pos += boldMatch[0].length;
      continue;
    }
    const boldUnderscoreMatch = remaining.match(/^__([^_]+?)__(?!_)/);
    if (boldUnderscoreMatch) {
      flush();
      nodes.push({ kind: "bold", children: parseInline(boldUnderscoreMatch[1]) });
      pos += boldUnderscoreMatch[0].length;
      continue;
    }

    // Italic: *text* or _text_.
    const italicMatch = remaining.match(/^\*([^*]+?)\*(?!\*)/);
    if (italicMatch) {
      flush();
      nodes.push({ kind: "italic", children: parseInline(italicMatch[1]) });
      pos += italicMatch[0].length;
      continue;
    }
    const italicUnderscoreMatch = remaining.match(/^_([^_]+?)_(?!_)/);
    if (italicUnderscoreMatch) {
      flush();
      nodes.push({ kind: "italic", children: parseInline(italicUnderscoreMatch[1]) });
      pos += italicUnderscoreMatch[0].length;
      continue;
    }

    // Link: [label](url) — url must be http/https or relative, no javascript:.
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      const url = linkMatch[2];
      if (/^https?:\/\//i.test(url) || /^[^/]/.test(url)) {
        flush();
        nodes.push({ kind: "link", label: linkMatch[1], url });
        pos += linkMatch[0].length;
        continue;
      }
    }

    // Raw HTML tag → render as literal text (security: never interpret).
    const htmlMatch = remaining.match(/^<\/?[a-zA-Z][^>]*>/);
    if (htmlMatch) {
      buffer += htmlMatch[0];
      pos += htmlMatch[0].length;
      continue;
    }

    // Default: accumulate one character.
    buffer += text[pos];
    pos++;
  }

  flush();
  return nodes;
}

// ─── Minimal syntax highlight (in-house, no dependency) ────────────────────

export type HighlightToken = { text: string; cls: string };

const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "interface", "type", "enum", "import", "export", "from", "default", "async", "await", "new", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "as", "extends", "implements", "public", "private", "protected", "readonly", "static", "get", "set", "void", "null", "undefined", "true", "false", "string", "number", "boolean", "any", "unknown", "never"]),
  js: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "from", "default", "async", "await", "new", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "extends", "get", "set", "void", "null", "undefined", "true", "false", "string", "number", "boolean"]),
  rust: new Set(["fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl", "pub", "use", "mod", "match", "if", "else", "for", "while", "loop", "return", "break", "continue", "as", "where", "self", "Self", "super", "crate", "move", "ref", "async", "await", "dyn", "unsafe", "true", "false", "Some", "None", "Ok", "Err", "Vec", "String", "Option", "Result"]),
  py: new Set(["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "as", "lambda", "yield", "raise", "pass", "break", "continue", "global", "nonlocal", "assert", "del", "in", "not", "and", "or", "is", "None", "True", "False", "self", "async", "await"]),
  json: new Set(["true", "false", "null"]),
  bash: new Set(["if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case", "esac", "function", "return", "echo", "export", "local", "readonly", "unset", "set", "shift", "test", "true", "false"]),
  css: new Set(["color", "background", "display", "flex", "grid", "padding", "margin", "border", "width", "height", "font", "text", "position", "top", "left", "right", "bottom", "z-index", "opacity", "transition", "transform", "animation"]),
  html: new Set(["div", "span", "a", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "td", "th", "img", "input", "button", "form", "label", "select", "option", "textarea", "code", "pre", "blockquote", "br", "hr"]),
  md: new Set(["requirement", "scenario", "when", "then"]),
};

const LANG_ALIASES: Record<string, string> = {
  typescript: "ts",
  tsx: "ts",
  javascript: "js",
  jsx: "js",
  python: "py",
  py3: "py",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rs: "rust",
  html: "html",
  htm: "html",
  markdown: "md",
  mdx: "md",
};

export function highlightCode(content: string, lang: string): HighlightToken[] {
  const normalizedLang = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  const keywords = KEYWORDS[normalizedLang];
  if (!keywords) {
    return [{ text: content, cls: "" }];
  }

  const tokens: HighlightToken[] = [];
  let pos = 0;

  while (pos < content.length) {
    const remaining = content.slice(pos);

    // Line comment: // ... (ts/js/rust/css) or # ... (py/bash)
    if (normalizedLang === "py" || normalizedLang === "bash") {
      const commentMatch = remaining.match(/^#.*$/m);
      if (commentMatch) {
        tokens.push({ text: commentMatch[0], cls: "md-hl-comment" });
        pos += commentMatch[0].length;
        continue;
      }
    } else if (normalizedLang === "ts" || normalizedLang === "js" || normalizedLang === "rust" || normalizedLang === "css") {
      const commentMatch = remaining.match(/^\/\/.*$/m);
      if (commentMatch) {
        tokens.push({ text: commentMatch[0], cls: "md-hl-comment" });
        pos += commentMatch[0].length;
        continue;
      }
      const blockCommentMatch = remaining.match(/^\/\*[\s\S]*?\*\//);
      if (blockCommentMatch) {
        tokens.push({ text: blockCommentMatch[0], cls: "md-hl-comment" });
        pos += blockCommentMatch[0].length;
        continue;
      }
    }

    // String: "..." or '...' or `...` (template literal).
    const stringMatch = remaining.match(/^(["'`])(?:\\.|(?!\1)[^\n])*\1?/);
    if (stringMatch) {
      tokens.push({ text: stringMatch[0], cls: "md-hl-string" });
      pos += stringMatch[0].length;
      continue;
    }

    // Number.
    const numberMatch = remaining.match(/^\b\d+(?:\.\d+)?\b/);
    if (numberMatch) {
      tokens.push({ text: numberMatch[0], cls: "md-hl-number" });
      pos += numberMatch[0].length;
      continue;
    }

    // Keyword (word boundary).
    const wordMatch = remaining.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (wordMatch) {
      const word = wordMatch[1];
      if (keywords.has(word)) {
        tokens.push({ text: word, cls: "md-hl-keyword" });
      } else {
        tokens.push({ text: word, cls: "" });
      }
      pos += word.length;
      continue;
    }

    // Default: one character.
    tokens.push({ text: content[pos], cls: "" });
    pos++;
  }

  return tokens;
}
