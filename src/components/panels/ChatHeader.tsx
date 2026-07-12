import { useEffect, useRef, useState } from "react";
import {
  Bug,
  ChevronDown,
  Command,
  GitBranch,
  GitPullRequest,
  Gauge,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AgentMode } from "../../lib/sessions";
import type { GitBranch as GitBranchInfo } from "../../lib/git";

/** Per-chat column header (`chat-header-context`).
 *
 * Renders above the conversation, never scrolls out of view. Every
 * interactive element has a `title=` tooltip.
 */

type PlanBadge = {
  referenceId: string;
  title: string;
  status: string;
} | null;

type ChatHeaderProps = {
  title: string;
  onRename: (title: string) => void;
  /** Locked titles are never auto-overwritten by titling. Set on user rename. */
  titleLocked: boolean;
  modelChip: string;
  modelId: string;
  effortChip: string;
  effortOptions: Array<{ id: string; label: string }>;
  onPickModel: () => void;
  onChangeEffort: (effort: string) => void;
  permissionMode: "safe" | "balanced" | "auto";
  onChangePermission: (mode: "safe" | "balanced" | "auto") => void;
  runState: "idle" | "queued" | "running";
  contextUsed: number;
  contextLimit: number | null;
  onOpenCommands: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
  canCopyConversation: boolean;
  onCopyConversation: () => void;
  agentMode: AgentMode;
  onToggleAgentMode: () => void;
  planBadge: PlanBadge;
  onOpenPlan: () => void;
  branch: string | null;
  worktreePath: string | null;
  branches: GitBranchInfo[];
  onSwitchBranch: (name: string) => void;
  onCreateBranch: (name: string) => void;
  /** Changed-file count for the switch confirmation prompt. 0 = clean. */
  uncommittedCount: number;
  onStashAndSwitch: (name: string) => void;
  onDiscardAndSwitch: (name: string) => void;
  onToggleHistory: () => void;
  onRenameAction: () => void;
  onAssignPlan: () => void;
  onDuplicateChat: () => void;
  onCloseChat: () => void;
  onCloseAndDelete: () => void;
  /** Shown when a worktree run has finished; null otherwise. */
  prRecommendation: { branch: string; ahead: number; behind: number; changedFiles: number } | null;
  onCreatePullRequest: () => void;
  /** Project path for the context badge. */
  projectPath: string;
  /** Chat session / run identifier. */
  sessionId?: string | null;
  onDragStart?: (e: React.MouseEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

export function ChatHeader(props: ChatHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(props.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraftTitle(props.title);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, props.title]);

  useEffect(() => {
    setDraftTitle(props.title);
  }, [props.title]);

  function commitRename() {
    setEditing(false);
    const next = draftTitle.trim();
    if (next && next !== props.title) {
      props.onRename(next);
    }
  }

  function cancelRename() {
    setEditing(false);
    setDraftTitle(props.title);
  }

  function handleSwitch(name: string) {
    setBranchOpen(false);
    if (name === props.branch) return;
    if (props.uncommittedCount > 0) {
      setSwitchTarget(name);
    } else {
      props.onSwitchBranch(name);
    }
  }

  function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    setCreatingBranch(false);
    setNewBranchName("");
    setBranchOpen(false);
    props.onCreateBranch(name);
  }

  const modeLabel = props.agentMode === "build" ? "Build mode" : "Plan mode";
  const modeTitle = props.agentMode === "build"
    ? "Build mode — edits allowed (approval gateway). Click to switch to plan mode."
    : "Plan mode — read-only posture. Click to switch to build mode.";

  return (
    <div
      className="chat-column-header"
      onMouseDown={props.onDragStart}
      onMouseUp={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <div className="chat-column-header-left">
        {editing ? (
          <input
            ref={inputRef}
            className="input chat-column-title-input"
            value={draftTitle}
            title="Rename chat — Enter to save, Esc to cancel"
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            className="chat-column-title"
            type="button"
            title={`${props.title}${props.titleLocked ? " (locked)" : ""} — double-click to rename`}
            onDoubleClick={() => setEditing(true)}
          >
            <span className="chat-column-title-text">{props.title}</span>
          </button>
        )}
        <button
          className="chat-column-model-chip"
          type="button"
          title={`Model: ${props.modelChip || props.modelId}. Click to change provider or model.`}
          onClick={props.onPickModel}
        >
          {truncate(props.modelChip || props.modelId, 14)}
          <ChevronDown size={9} />
        </button>
        {props.effortOptions.length > 1 ? (
          <select
            className="chat-header-select"
            title={`Effort level: ${props.effortChip}`}
            aria-label="Effort level"
            value={props.effortChip}
            onChange={(event) => props.onChangeEffort(event.target.value)}
          >
            {props.effortOptions.map((effort) => (
              <option key={effort.id} value={effort.id}>{effort.label}</option>
            ))}
          </select>
        ) : (
          <span className="chat-header-static" title={`Effort: ${props.effortChip || "Standard"}`}>
            {props.effortOptions[0]?.label ?? "Standard"}
          </span>
        )}
        <select
          className="chat-header-select chat-header-permission"
          title={`Permission mode: ${permissionLabel(props.permissionMode)}`}
          aria-label="Permission mode"
          value={props.permissionMode}
          onChange={(event) => props.onChangePermission(event.target.value as "safe" | "balanced" | "auto")}
        >
          <option value="balanced">Balanced</option>
          <option value="safe">Always Ask</option>
          <option value="auto">Run Everything</option>
        </select>
        <span className={`chat-header-run-state is-${props.runState}`} title={`Agent state: ${props.runState}`}>
          {props.runState}
        </span>
        <ContextIndicator used={props.contextUsed} limit={props.contextLimit} />
        <button
          className={`chat-column-mode-pill${props.agentMode === "build" ? " is-build" : " is-plan"}`}
          type="button"
          title={modeTitle}
          aria-pressed={props.agentMode === "build"}
          onClick={props.onToggleAgentMode}
        >
          {modeLabel}
        </button>
        {props.planBadge ? (
          <button
            className="chat-column-plan-badge"
            type="button"
            title={`Plan ${props.planBadge.referenceId}: ${props.planBadge.title} (${props.planBadge.status})`}
            onClick={props.onOpenPlan}
          >
            <Sparkles size={10} />
            <span className="chat-column-plan-ref">#{props.planBadge.referenceId}</span>
            <span className="chat-column-plan-title">{truncate(props.planBadge.title, 20)}</span>
          </button>
        ) : null}
      </div>
      <div className="chat-column-header-right">
        {props.branch ? (
          <div className="chat-column-branch-group">
            {props.worktreePath ? (
              <span className="chat-column-worktree" title={`Worktree: ${props.worktreePath}`}>
                [worktree]
              </span>
            ) : null}
            <button
              className="chat-column-branch"
              type="button"
              title={`Branch: ${props.branch}. Click to switch or create.`}
              onClick={() => setBranchOpen((v) => !v)}
            >
              <GitBranch size={11} />
              <span className="chat-column-branch-name">{props.branch}</span>
              <ChevronDown size={10} />
            </button>
            {branchOpen ? (
              <BranchDropdown
                branches={props.branches}
                current={props.branch}
                onPick={handleSwitch}
                onCreate={() => { setCreatingBranch(true); setNewBranchName(""); }}
                creating={creatingBranch}
                newBranchName={newBranchName}
                setNewBranchName={setNewBranchName}
                onCreateBranch={handleCreateBranch}
                onCancelCreate={() => setCreatingBranch(false)}
              />
            ) : null}
          </div>
        ) : null}
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Open command palette"
          onClick={props.onOpenCommands}
        >
          <Command size={13} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="Toggle chat history"
          onClick={props.onToggleHistory}
        >
          <HistoryIcon />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title="More actions"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={13} />
        </button>
        {menuOpen ? (
          <MoreActionsMenu
            onRename={() => { setMenuOpen(false); setEditing(true); }}
            onAssignPlan={() => { setMenuOpen(false); props.onAssignPlan(); }}
            onDuplicate={() => { setMenuOpen(false); props.onDuplicateChat(); }}
            onClose={() => { setMenuOpen(false); props.onCloseChat(); }}
            onCloseAndDelete={() => { setMenuOpen(false); props.onCloseAndDelete(); }}
            prRecommendation={props.prRecommendation}
            onCreatePullRequest={() => { setMenuOpen(false); props.onCreatePullRequest(); }}
            debugMode={props.debugMode}
            onToggleDebug={() => { setMenuOpen(false); props.onToggleDebug(); }}
            canCopyConversation={props.canCopyConversation}
            onCopyConversation={() => { setMenuOpen(false); props.onCopyConversation(); }}
          />
        ) : null}
      </div>
      {switchTarget ? (
        <SwitchConfirm
          target={switchTarget}
          uncommittedCount={props.uncommittedCount}
          onStash={() => { props.onStashAndSwitch(switchTarget); setSwitchTarget(null); }}
          onDiscard={() => { props.onDiscardAndSwitch(switchTarget); setSwitchTarget(null); }}
          onCancel={() => setSwitchTarget(null)}
        />
      ) : null}
    </div>
  );
}

function BranchDropdown(props: {
  branches: GitBranchInfo[];
  current: string;
  onPick: (name: string) => void;
  onCreate: () => void;
  creating: boolean;
  newBranchName: string;
  setNewBranchName: (v: string) => void;
  onCreateBranch: () => void;
  onCancelCreate: () => void;
}) {
  return (
    <div className="chat-branch-dropdown" role="dialog" aria-label="Switch branch">
      <div className="chat-branch-dropdown-list">
        {props.branches.map((b) => (
          <button
            key={b.name}
            className={`chat-branch-dropdown-item${b.name === props.current ? " is-active" : ""}`}
            type="button"
            title={`${b.name}${b.name === props.current ? " (current)" : ""}`}
            onClick={() => props.onPick(b.name)}
          >
            <GitBranch size={11} />
            <span>{b.name}</span>
            {b.name === props.current ? <span className="chat-branch-current">✓</span> : null}
          </button>
        ))}
      </div>
      {props.creating ? (
        <div className="chat-branch-create">
          <input
            className="input chat-branch-create-input"
            placeholder="branch-name"
            title="New branch name"
            value={props.newBranchName}
            onChange={(e) => props.setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); props.onCreateBranch(); }
              if (e.key === "Escape") { e.preventDefault(); props.onCancelCreate(); }
            }}
            autoFocus
          />
          <button className="btn btn-sm btn-primary" type="button" title="Create branch" onClick={props.onCreateBranch}>
            <Plus size={11} /> Create
          </button>
          <button className="btn-icon btn-icon-sm" type="button" title="Cancel" onClick={props.onCancelCreate}>
            <X size={11} />
          </button>
        </div>
      ) : (
        <button className="chat-branch-dropdown-create" type="button" title="Create a new branch" onClick={props.onCreate}>
          <Plus size={11} /> Create branch…
        </button>
      )}
    </div>
  );
}

function MoreActionsMenu(props: {
  onRename: () => void;
  onAssignPlan: () => void;
  onDuplicate: () => void;
  onClose: () => void;
  onCloseAndDelete: () => void;
  prRecommendation: { branch: string; ahead: number; behind: number; changedFiles: number } | null;
  onCreatePullRequest: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
  canCopyConversation: boolean;
  onCopyConversation: () => void;
}) {
  return (
    <div className="chat-more-menu" role="dialog" aria-label="Chat actions">
      <MenuItem icon={Pencil} label="Rename" title="Rename this chat" onClick={props.onRename} />
      <MenuItem icon={Sparkles} label="Assign plan" title="Assign a ready plan to this chat" onClick={props.onAssignPlan} />
      <MenuItem icon={CopyIcon} label="Duplicate chat" title="Duplicate this chat's settings into a new column" onClick={props.onDuplicate} />
      <MenuItem icon={CopyIcon} label="Copy conversation" title="Copy the entire conversation as markdown" onClick={props.onCopyConversation} disabled={!props.canCopyConversation} />
      <MenuItem icon={Bug} label={props.debugMode ? "Hide debug events" : "Show debug events"} title={props.debugMode ? "Turn debug event rendering off" : "Show raw event data in tool cards"} onClick={props.onToggleDebug} />
      {props.prRecommendation ? (
        <MenuItem icon={GitPullRequest} label="Create pull request" title={`Open a PR for ${props.prRecommendation.branch} (${props.prRecommendation.changedFiles} files, +${props.prRecommendation.ahead}/-${props.prRecommendation.behind})`} onClick={props.onCreatePullRequest} />
      ) : null}
      <MenuItem icon={X} label="Close chat" title="Close this chat column (session retained)" onClick={props.onClose} />
      <MenuItem icon={TrashIcon} label="Close chat and delete session" title="Permanently delete this chat's history" onClick={props.onCloseAndDelete} danger />
    </div>
  );
}

function MenuItem({ icon: Icon, label, title, onClick, danger, disabled }: { icon: React.ComponentType<{ size?: number }>; label: string; title: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      className={`chat-more-menu-item${danger ? " is-danger" : ""}`}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={11} />
      <span>{label}</span>
    </button>
  );
}

function SwitchConfirm(props: {
  target: string;
  uncommittedCount: number;
  onStash: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="chat-switch-confirm" role="dialog" aria-label="Confirm branch switch">
      <div className="chat-switch-confirm-body">
        <p className="text-sm">
          {props.uncommittedCount} uncommitted file{props.uncommittedCount === 1 ? "" : "s"} — switching to <strong>{props.target}</strong> requires stashing or discarding.
        </p>
        <div className="chat-switch-confirm-actions">
          <button className="btn btn-sm" type="button" title="Stash changes and switch branch" onClick={props.onStash}>
            Stash &amp; switch
          </button>
          <button className="btn btn-sm" type="button" title="Discard changes and switch branch" onClick={props.onDiscard}>
            Discard &amp; switch
          </button>
          <button className="btn-icon btn-icon-sm" type="button" title="Cancel switch" onClick={props.onCancel}>
            <X size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function CopyIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ContextIndicator({ used, limit }: { used: number; limit: number | null }) {
  const percentage = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const circumference = 31.42;
  const filled = circumference * percentage / 100;
  const ratio = limit && limit > 0
    ? `${used.toLocaleString()} / ${limit.toLocaleString()} tokens (${percentage}%)`
    : `${used.toLocaleString()} tokens; model context limit unavailable`;
  return (
    <span className={`chat-header-context is-${percentage >= 85 ? "critical" : percentage >= 60 ? "warning" : "healthy"}`} title={`Context usage: ${ratio}`}>
      <svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true">
        <circle className="chat-header-context-track" cx="6" cy="6" r="5" />
        <circle className="chat-header-context-value" cx="6" cy="6" r="5" strokeDasharray={`${filled} ${circumference - filled}`} />
      </svg>
      <Gauge className="chat-header-context-gauge" size={8} />
    </span>
  );
}

function permissionLabel(mode: "safe" | "balanced" | "auto") {
  if (mode === "safe") return "Always Ask";
  if (mode === "auto") return "Run Everything";
  return "Balanced";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
