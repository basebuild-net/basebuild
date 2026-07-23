import { useState } from "react";
import { ChevronDown, Loader2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { ActionMenu } from "../ActionMenu";

/** Model / provider / effort / permission controls, rendered under the
 *  composer input (not in the pinned header). The secondary controls collapse
 *  behind a toggle so the composer stays compact on narrow panels; the model
 *  chip always stays visible. Dropdowns portal to the body and flip upward at
 *  the bottom of the viewport (see ActionMenu). */

const COLLAPSE_KEY = "basebuild.composer-controls-collapsed.v1";

type Props = {
  modelChip: string;
  modelId: string;
  modelCatalogStatus: "loading" | "refreshing" | "ready" | "stale" | "error";
  modelCatalogError?: string | null;
  onPickModel: () => void;
  effortChip: string;
  effortOptions: Array<{ id: string; label: string }>;
  onChangeEffort: (effort: string) => void;
  permissionMode: "safe" | "balanced" | "auto";
  onChangePermission: (mode: "safe" | "balanced" | "auto") => void;
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function ChatComposerControls(props: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore persistence failures
      }
      return next;
    });
  }

  const effortLabel = props.effortOptions.find((o) => o.id === props.effortChip)?.label ?? props.effortChip;
  const permissionLabel = props.permissionMode === "safe"
    ? "Always Ask"
    : props.permissionMode === "auto"
      ? "Run Everything"
      : "Balanced";
  const busy = props.modelCatalogStatus === "loading" || props.modelCatalogStatus === "refreshing";
  const hasEffort = props.effortOptions.length > 1;

  return (
    <div className="chat-composer-tools">
      <button
        className={`chat-column-model-chip is-catalog-${props.modelCatalogStatus}`}
        type="button"
        title={
          props.modelCatalogStatus === "error" || props.modelCatalogStatus === "stale"
            ? `Model: ${props.modelChip}. ${props.modelCatalogError ?? "Catalog unavailable"}. Click to change provider or model.`
            : `Model & provider: ${props.modelChip}. Click to change.`
        }
        onClick={props.onPickModel}
      >
        {busy ? <Loader2 size={10} className="spin" aria-hidden="true" /> : null}
        <span>{truncate(props.modelChip || props.modelId || "Model", 18)}</span>
        <ChevronDown size={9} />
      </button>

      {!collapsed && hasEffort ? (
        <ActionMenu
          triggerTitle={`Effort level: ${effortLabel}`}
          triggerClassName="chat-header-menu-trigger"
          icon={<><span>{effortLabel}</span><ChevronDown size={9} /></>}
          items={props.effortOptions.map((option) => ({
            key: option.id,
            label: option.label,
            title: `Use ${option.label} effort`,
            onSelect: () => props.onChangeEffort(option.id),
          }))}
        />
      ) : null}

      {!collapsed ? (
        <ActionMenu
          triggerTitle={`Permission mode: ${permissionLabel}`}
          triggerClassName="chat-header-menu-trigger chat-header-permission-trigger"
          icon={<><ShieldCheck size={10} /><span>{permissionLabel}</span><ChevronDown size={9} /></>}
          items={[
            { key: "balanced", label: "Balanced", title: "Ask before sensitive actions", onSelect: () => props.onChangePermission("balanced") },
            { key: "safe", label: "Always Ask", title: "Ask before every tool action", onSelect: () => props.onChangePermission("safe") },
            { key: "auto", label: "Run Everything", title: "Allow tool actions without prompting", onSelect: () => props.onChangePermission("auto") },
          ]}
        />
      ) : null}

      <button
        className="chat-composer-tools-toggle"
        type="button"
        aria-pressed={!collapsed}
        title={collapsed ? "Show effort & permission controls" : "Hide effort & permission controls"}
        onClick={toggle}
      >
        <SlidersHorizontal size={12} />
      </button>
    </div>
  );
}
