import { Command, Key, RefreshCw, Unplug } from "lucide-react";
import type { NativeProviderCatalog } from "../../lib/native-chat";

/** Compact single-line composer rail (`chat-composer-controls`).
 *
 * Renders provider/model/effort/connect/refresh + the Ideas entry point on
 * a single line above the textarea, with truncation and per-column
 * independence. Every interactive element has a `title=` tooltip.
 */

export type ChatComposerRailProps = {
  catalog: NativeProviderCatalog | null;
  providerId: string;
  providerName: string;
  providerDegraded: boolean;
  modelId: string;
  modelName: string;
  effortLevel: string;
  catalogRefreshing: boolean;
  lastSyncedAt: number | null;
  /** Local provider id — the connect/disconnect affordance is hidden for it. */
  localProviderId: string;
  onPickProvider: () => void;
  onPickModel: () => void;
  supportedEfforts: string[];
  onChangeEffort: (effort: string) => void;
  onRefresh: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Open the slash command palette (fills the composer, does not execute). */
  onOpenCommands: () => void;
};

export function ChatComposerRail(props: ChatComposerRailProps) {
  const { catalog, providerDegraded, providerName, modelName, modelId, effortLevel } = props;
  const effortOptions = catalog?.effortLevels.filter((effort) => props.supportedEfforts.includes(effort.id)) ?? [];
  return (
    <div className="chat-composer-header">
      {catalog ? (
        <>
          <button
            className={`btn btn-sm chat-provider-trigger${providerDegraded ? " is-warn" : ""}`}
            type="button"
            title={`${providerName} — ${providerDegraded ? "setup required" : "ready"}. Click to choose or connect a provider.`}
            onClick={props.onPickProvider}
          >
            <span className={`chat-health-dot ${providerDegraded ? "is-warn" : "is-ok"}`} />
            <span className="chat-trigger-label">{providerName}</span>
          </button>
          <button
            className="btn btn-sm chat-model-trigger"
            type="button"
            title={`Select model. Current model: ${modelName} (${modelId})`}
            onClick={props.onPickModel}
          >
            <span className="chat-trigger-kicker">Model</span>
            <span className="chat-trigger-label">{modelName}</span>
          </button>
          {effortOptions.length > 0 ? (
            <select
              className="input chat-select chat-effort-select"
              title="Select an effort level supported by this model"
              value={effortOptions.some((effort) => effort.id === effortLevel) ? effortLevel : effortOptions[0].id}
              onChange={(e) => props.onChangeEffort(e.target.value)}
            >
              {effortOptions.map((ef) => (
                <option key={ef.id} value={ef.id}>{ef.label}</option>
              ))}
            </select>
          ) : (
            <span className="chat-effort-static" title="This model does not expose reasoning effort controls">Standard</span>
          )}
          <button
            className="btn-icon btn-icon-sm"
            type="button"
            title={props.lastSyncedAt ? `Refresh models. Last sync: ${new Date(props.lastSyncedAt * 1000).toLocaleString()}` : "Refresh models"}
            disabled={props.catalogRefreshing}
            onClick={props.onRefresh}
          >
            <RefreshCw size={12} className={props.catalogRefreshing ? "spin" : ""} />
          </button>
          {providerDegraded ? (
            <button
              className="btn-icon btn-icon-sm"
              type="button"
              title={`Connect ${providerName}`}
              onClick={props.onConnect}
            >
              <Key size={11} />
            </button>
          ) : null}
          {props.providerId !== props.localProviderId ? (
            <button
              className="btn-icon btn-icon-sm"
              type="button"
              title={`Disconnect ${providerName}`}
              onClick={props.onDisconnect}
            >
              <Unplug size={11} />
            </button>
          ) : null}
          <button
            className="chat-commands-btn"
            type="button"
            title="Open the command palette — browse and insert slash commands"
            onClick={props.onOpenCommands}
          >
            <Command size={11} /> Commands
          </button>
        </>
      ) : (
        <div className="chat-select-group">
          <span className="chat-select-skeleton" />
          <span className="chat-select-skeleton" />
          <span className="chat-select-skeleton" />
        </div>
      )}
    </div>
  );
}
