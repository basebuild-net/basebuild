import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Bug,
  ChevronDown,
  Command,
  FolderGit2,
  Settings,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { AgentMode } from "../../lib/sessions";
import type { GitBranch as GitBranchInfo } from "../../lib/git";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu";
import { t } from "../../i18n";
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
  onCloseChat: () => void;
  onCloseAndDelete: () => void;
  /** Shown when a worktree run has finished; null otherwise. */
  prRecommendation: { branch: string; ahead: number; behind: number; changedFiles: number } | null;
  onCreatePullRequest: () => void;
  /** Project path for the context badge. */
  projectPath: string;
  /** Chat session / run identifier. */
  sessionId?: string | null;
  /** Copy the chat session ID to clipboard. */
  onCopySessionId?: () => void;
  /** Start a hands-free voice call. Null when voice is unsupported. */
  onStartVoiceCall?: (() => void) | null;
  /** Whether a voice call is currently active. */
  voiceCallActive?: boolean;
  /** Open the voice settings modal (engine, STT downloads, TTS, call mode). */
  onOpenVoiceSettings?: () => void;
  onDragStart?: (e: React.MouseEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
};

export function ChatTitleBar(props: {
  title: string;
  onRename: (title: string) => void;
  titleLocked: boolean;
  /** Increment this number to trigger edit mode externally (e.g. from the more-actions menu). */
  renameSignal: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(props.title);
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

  // External rename trigger
  useEffect(() => {
    if (props.renameSignal > 0) setEditing(true);
  }, [props.renameSignal]);

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

  return (
    <div className="chat-title-bar">
      {editing ? (
        <input
          ref={inputRef}
          className="input chat-column-title-input"
          value={draftTitle}
          title={t("chatHeader.renameChatEnterToSave")}
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
          title={t((props.titleLocked ? "chatHeader.doubleClickToRename.locked" : "chatHeader.doubleClickToRename.none"), { title: props.title })}
          onDoubleClick={() => setEditing(true)}
        >
          <span className="chat-column-title-text">{props.title}</span>
        </button>
      )}
    </div>
  );
}

export function ChatHeader(props: ChatHeaderProps) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState<{ left: number; top: number; above: boolean }>({
    left: 8,
    top: 8,
    above: false,
  });
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

  function toggleBranchMenu(event: React.MouseEvent<HTMLButtonElement>) {
    if (branchOpen) {
      setBranchOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const above = window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight - rect.bottom;
    setBranchMenuPosition({
      left: Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248)),
      top: above ? rect.top - 4 : rect.bottom + 4,
      above,
    });
    setBranchOpen(true);
  }

  const modeLabel = props.agentMode === "build" ? t("chatHeader.buildMode") : t("chatHeader.planMode");
  const modeTitle = props.agentMode === "build"
    ? t("chatHeader.buildModeEditsAllowedApprovalGateway")
    : t("chatHeader.planModeReadOnlyPostureClick");

  const workspaceLabel = props.worktreePath
    ? props.worktreePath.split(/[\\/]/).pop() ?? t("chatHeader.worktree2")
    : props.projectPath.split(/[\\/]/).pop() ?? t("chatHeader.workspace2");
  const actionItems: ActionMenuItem[] = [
    { key: "rename", label: t("chatHeader.rename"), title: t("chatHeader.renameThisChat"), icon: <Pencil size={11} />, onSelect: props.onRenameAction },
    { key: "assign", label: t("chatHeader.assignPlan"), title: t("chatHeader.assignAReadyPlanToThis"), icon: <Sparkles size={11} />, onSelect: props.onAssignPlan },
    { key: "copy", label: t("chatHeader.copyConversation"), title: t("chatHeader.copyTheConversationAsMarkdown"), icon: <CopyIcon />, disabled: !props.canCopyConversation, onSelect: props.onCopyConversation },
    ...(props.onCopySessionId ? [{ key: "copy-id", label: t("chatHeader.copyChatId"), title: t("chatHeader.copyTheChatSessionIdentifier"), icon: <CopyIcon />, onSelect: props.onCopySessionId }] : []),
    ...(props.onStartVoiceCall ? [{
      key: "voice-call",
      label: props.voiceCallActive ? t("chatHeader.endVoiceCall") : t("chatHeader.startVoiceCall"),
      title: props.voiceCallActive
        ? t("chatHeader.hangUpTheActiveVoiceCall")
        : t("chatHeader.startAHandsFreeVoiceCall"),
      icon: <Phone size={11} />,
      onSelect: props.onStartVoiceCall,
    }] : []),
    ...(props.onOpenVoiceSettings ? [{
      key: "voice-settings",
      label: t("chatHeader.voiceSettings"),
      title: t("chatHeader.configureSpeechToTextEngineDownload"),
      icon: <Settings size={11} />,
      onSelect: props.onOpenVoiceSettings,
    }] : []),
    { key: "debug", label: props.debugMode ? t("chatHeader.hideDebugEvents") : t("chatHeader.showDebugEvents"), title: props.debugMode ? t("chatHeader.turnDebugEventRenderingOff") : t("chatHeader.showRawEventDataInTool"), icon: <Bug size={11} />, onSelect: props.onToggleDebug },
    ...(props.prRecommendation ? [{
      key: "pull-request",
      label: t("chatHeader.createPullRequest"),
      title: `Open a PR for ${props.prRecommendation.branch}`,
      icon: <GitPullRequest size={11} />,
      onSelect: props.onCreatePullRequest,
    }] : []),
    { key: "close", label: t("chatHeader.closeChat"), title: t("chatHeader.closeThisChatWindowSessionRetained"), icon: <X size={11} />, onSelect: props.onCloseChat },
    { key: "delete", label: t("chatHeader.closeAndDeleteSession"), title: t("chatHeader.permanentlyDeleteThisChatHistory"), icon: <TrashIcon />, danger: true, onSelect: props.onCloseAndDelete },
  ];

  return (
    <div
      className="chat-column-header"
      onMouseDown={props.onDragStart}
      onMouseUp={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      <div className="chat-column-header-left">
        <span className={`chat-header-run-state is-${props.runState}`} title={t("chatHeader.agentState", { runState: props.runState })}>
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
            title={t("chatHeader.plan", { referenceId: props.planBadge.referenceId, title: props.planBadge.title, status: props.planBadge.status })}
            onClick={props.onOpenPlan}
          >
            <Sparkles size={10} />
            <span className="chat-column-plan-ref">#{props.planBadge.referenceId}</span>
            <span className="chat-column-plan-title">{truncate(props.planBadge.title, 20)}</span>
          </button>
        ) : null}
      </div>
      <div className="chat-column-header-right">
        <span className="chat-header-workspace" title={props.worktreePath ? t("chatHeader.worktree", { worktreePath: props.worktreePath }) : t("chatHeader.workspace", { projectPath: props.projectPath })}>
          <FolderGit2 size={10} />
          <span>{workspaceLabel}</span>
        </span>
        {props.branch ? (
          <div className="chat-column-branch-group">
            <button
              className="chat-column-branch"
              type="button"
              title={t("chatHeader.branchClickToSwitchOrCreate", { branch: props.branch })}
              aria-expanded={branchOpen}
              onClick={toggleBranchMenu}
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
                onDismiss={() => setBranchOpen(false)}
                position={branchMenuPosition}
              />
            ) : null}
          </div>
        ) : null}
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={t("chatHeader.openCommandPalette")}
          onClick={props.onOpenCommands}
        >
          <Command size={13} />
        </button>
        <button
          className="btn-icon btn-icon-sm"
          type="button"
          title={t("chatHeader.toggleChatHistory")}
          onClick={props.onToggleHistory}
        >
          <HistoryIcon />
        </button>
        <ActionMenu
          items={actionItems}
          triggerTitle={t("chatHeader.moreChatActions")}
          triggerClassName="btn-icon btn-icon-sm"
          icon={<MoreHorizontal size={13} />}
        />
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

export function BranchDropdown(props: {
  branches: GitBranchInfo[];
  current: string;
  onPick: (name: string) => void;
  onCreate: () => void;
  creating: boolean;
  newBranchName: string;
  setNewBranchName: (v: string) => void;
  onCreateBranch: () => void;
  onCancelCreate: () => void;
  onDismiss: () => void;
  position: { left: number; top: number; above: boolean };
}) {
  const style = {
    "--bb-dropdown-left": `${props.position.left}px`,
    "--bb-dropdown-top": `${props.position.top}px`,
  } as CSSProperties;
  return createPortal(
    <div className="chat-branch-dropdown-overlay" role="presentation" onMouseDown={props.onDismiss}>
      <div
        className={`chat-branch-dropdown${props.position.above ? " is-above" : ""}`}
        role="dialog"
        aria-label={t("chatHeader.switchBranch")}
        style={style}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="chat-branch-dropdown-list">
          {props.branches.map((branch) => (
            <button
              key={branch.name}
              className={`chat-branch-dropdown-item${branch.name === props.current ? " is-active" : ""}`}
              type="button"
              title={t((branch.name === props.current ? "chatHeader.text.current" : "chatHeader.text.none"), { name: branch.name })}
              onClick={() => props.onPick(branch.name)}
            >
              <GitBranch size={11} />
              <span>{branch.name}</span>
              {branch.name === props.current ? <span className="chat-branch-current">✓</span> : null}
            </button>
          ))}
        </div>
        {props.creating ? (
          <div className="chat-branch-create">
            <input
              className="input chat-branch-create-input"
              placeholder={t("chatHeader.branchName")}
              title={t("chatHeader.newBranchName")}
              value={props.newBranchName}
              onChange={(event) => props.setNewBranchName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); props.onCreateBranch(); }
                if (event.key === "Escape") { event.preventDefault(); props.onCancelCreate(); }
              }}
              autoFocus
            />
            <button className="btn btn-sm btn-primary" type="button" title={t("chatHeader.createBranch")} onClick={props.onCreateBranch}>
              <Plus size={11} /> {t("chatHeader.create")}
            </button>
            <button className="btn-icon btn-icon-sm" type="button" title={t("chatHeader.cancel")} onClick={props.onCancelCreate}>
              <X size={11} />
            </button>
          </div>
        ) : (
          <button className="chat-branch-dropdown-create" type="button" title={t("chatHeader.createANewBranch")} onClick={props.onCreate}>
            <Plus size={11} /> {t("chatHeader.createBranch2")}
          </button>
        )}
      </div>
    </div>,
    document.body,
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
    <div className="chat-switch-confirm" role="dialog" aria-label={t("chatHeader.confirmBranchSwitch")}>
      <div className="chat-switch-confirm-body">
        <p className="text-sm">{t(props.uncommittedCount === 1 ? "chatHeader.switchOne" : "chatHeader.switchMany", { count: props.uncommittedCount, target: props.target })}</p>
        <div className="chat-switch-confirm-actions">
          <button className="btn btn-sm" type="button" title={t("chatHeader.stashChangesAndSwitchBranch")} onClick={props.onStash}>
            {t("chatHeader.stashSwitch")}
          </button>
          <button className="btn btn-sm" type="button" title={t("chatHeader.discardChangesAndSwitchBranch")} onClick={props.onDiscard}>
            {t("chatHeader.discardSwitch")}
          </button>
          <button className="btn-icon btn-icon-sm" type="button" title={t("chatHeader.cancelSwitch")} onClick={props.onCancel}>
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
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * percentage / 100;
  const ratio = limit && limit > 0
    ? `${used.toLocaleString()} / ${limit.toLocaleString()} tokens (${percentage}%)`
    : `${used.toLocaleString()} tokens; model context limit unavailable`;
  return (
    <span className={`chat-header-context is-${percentage >= 85 ? "critical" : percentage >= 60 ? "warning" : "healthy"}`} title={t("chatHeader.contextUsage", { ratio: ratio })}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle className="chat-header-context-track" cx="10" cy="10" r={r} />
        <circle className="chat-header-context-value" cx="10" cy="10" r={r} strokeDasharray={`${filled} ${circumference - filled}`} />
      </svg>
      <span className="chat-header-context-pct">{percentage}</span>
    </span>
  );
}


function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
