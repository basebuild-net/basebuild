import { memo, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, highlightCode, type MdBlock, type MdInline, type HighlightToken } from "../../lib/markdown";

type MarkdownViewProps = {
  text: string;
  className?: string;
};

/// Safe markdown renderer: emits React elements only.
/// No HTML strings, no dangerouslySetInnerHTML, no dependencies.
/// Raw HTML in source renders as literal text. Links don't navigate.
/// Streaming-safe: re-parses accumulated text each render; parser never throws.
export const MarkdownView = memo(function MarkdownView({ text, className }: MarkdownViewProps) {
  const blocks = useMemo(() => {
    try {
      return parseMarkdown(text);
    } catch {
      // Parser should never throw, but degrade gracefully if it does.
      return [{ kind: "paragraph", children: [{ kind: "text", text }] }] as MdBlock[];
    }
  }, [text]);

  return (
    <div className={`md-body${className ? ` ${className}` : ""}`}>
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
});

// ─── Block renderers ───────────────────────────────────────────────────────

function BlockRenderer({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "fence":
      return <FenceBlock lang={block.lang} content={block.content} />;
    case "heading":
      return <HeadingBlock level={block.level} children={block.children} />;
    case "paragraph":
      return <p className="md-paragraph"><InlineRenderer children={block.children} /></p>;
    case "blockquote":
      return <blockquote className="md-blockquote"><InlineRenderer children={block.children} /></blockquote>;
    case "list":
      return <ListBlock ordered={block.ordered} items={block.items} />;
    case "table":
      return <TableBlock headers={block.headers} rows={block.rows} />;
    case "hr":
      return <hr className="md-hr" />;
  }
}

function FenceBlock({ lang, content }: { lang: string; content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; fail silently.
    }
  };

  const tokens = useMemo<HighlightToken[]>(
    () => (lang ? highlightCode(content, lang) : [{ text: content, cls: "" }]),
    [content, lang],
  );

  return (
    <div className="md-code-block" title={lang ? `Code block: ${lang}` : "Code block"}>
      <div className="md-code-header">
        <span className="md-code-lang">{lang || "text"}</span>
        <button
          type="button"
          className="md-code-copy btn btn-ghost btn-icon-sm"
          title={copied ? "Copied to clipboard" : "Copy code to clipboard"}
          onClick={() => void handleCopy()}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="md-code-pre">
        <code>
          {tokens.map((tok, i) => (
            <span key={i} className={tok.cls || undefined}>{tok.text}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function HeadingBlock({ level, children }: { level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }) {
  const cls = `md-heading md-heading-${level}`;
  const content = <InlineRenderer children={children} />;
  switch (level) {
    case 1: return <h1 className={cls}>{content}</h1>;
    case 2: return <h2 className={cls}>{content}</h2>;
    case 3: return <h3 className={cls}>{content}</h3>;
    case 4: return <h4 className={cls}>{content}</h4>;
    case 5: return <h5 className={cls}>{content}</h5>;
    case 6: return <h6 className={cls}>{content}</h6>;
  }
}

function ListBlock({ ordered, items }: { ordered: boolean; items: MdInline[][] }) {
  if (ordered) {
    return (
      <ol className="md-list md-list-ordered">
        {items.map((item, i) => (
          <li key={i} className="md-list-item"><InlineRenderer children={item} /></li>
        ))}
      </ol>
    );
  }
  return (
    <ul className="md-list md-list-unordered">
      {items.map((item, i) => (
        <li key={i} className="md-list-item"><InlineRenderer children={item} /></li>
      ))}
    </ul>
  );
}

function TableBlock({ headers, rows }: { headers: MdInline[][]; rows: MdInline[][][] }) {
  return (
    <table className="md-table">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} className="md-table-header"><InlineRenderer children={h} /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="md-table-row">
            {row.map((cell, ci) => (
              <td key={ci} className="md-table-cell"><InlineRenderer children={cell} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Inline renderer ───────────────────────────────────────────────────────

function InlineRenderer({ children }: { children: MdInline[] }) {
  return (
    <>
      {children.map((node, i) => {
        switch (node.kind) {
          case "text":
            return <span key={i}>{node.text}</span>;
          case "code":
            return <code key={i} className="md-inline-code">{node.text}</code>;
          case "bold":
            return <strong key={i} className="md-bold"><InlineRenderer children={node.children} /></strong>;
          case "italic":
            return <em key={i} className="md-italic"><InlineRenderer children={node.children} /></em>;
          case "link":
            // Links render as non-navigating text with full URL in tooltip.
            // No onClick, no href — clicking does nothing.
            return (
              <span key={i} className="md-link" title={node.url}>
                {node.label} ({extractHost(node.url)})
              </span>
            );
        }
      })}
    </>
  );
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
