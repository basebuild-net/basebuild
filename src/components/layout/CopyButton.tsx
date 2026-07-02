import { useState } from "react";
import { Check, Copy } from "lucide-react";

type CopyButtonProps = {
  text: string;
  label?: string;
  className?: string;
};

/// Small copy-to-clipboard button with a transient "Copied" state.
/// Uses `navigator.clipboard.writeText` — the same pattern as
/// `ErrorBoundary.copyDetails` and `LogPanel.copyAll`.
export function CopyButton({ text, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in some contexts; fail silently.
    }
  };

  return (
    <button
      type="button"
      className={className ?? "btn btn-ghost btn-icon-sm"}
      title={copied ? "Copied to clipboard" : "Copy to clipboard"}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
