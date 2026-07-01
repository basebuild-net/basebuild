import { useState } from "react";
import { Check, ChevronRight, Lightbulb, Plus, Trash2 } from "lucide-react";

import { useIdeaState } from "../../state/ideas";
import type { IdeaStatus } from "../../lib/ideas";

const STATUS_LABELS: Record<IdeaStatus, string> = {
  concept: "Concept",
  planReady: "Plan Ready",
  inProgress: "In Progress",
  finished: "Finished",
  paused: "Paused",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<IdeaStatus, string> = {
  concept: "is-concept",
  planReady: "is-plan-ready",
  inProgress: "is-in-progress",
  finished: "is-finished",
  paused: "is-paused",
  cancelled: "is-cancelled",
};

const STATUS_ORDER: IdeaStatus[] = ["concept", "planReady", "inProgress", "finished", "paused", "cancelled"];

type IdeasPanelProps = {
  sessionId: string | null;
};

export function IdeasPanel({ sessionId }: IdeasPanelProps) {
  const { ideas, categories, createIdea, updateIdeaStatus, removeIdea, createCategory } = useIdeaState(sessionId);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newIdeaTitle, setNewIdeaTitle] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(ideas.map((i) => i.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  async function handleCreateIdea() {
    if (!newIdeaTitle.trim() || !sessionId) return;
    await createIdea(newIdeaTitle, "");
    setNewIdeaTitle("");
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim() || !sessionId) return;
    await createCategory(newCategoryName, "");
    setNewCategoryName("");
    setShowCategoryInput(false);
  }

  if (!sessionId) {
    return (
      <div className="empty-state">
        <Lightbulb size={32} className="text-muted" />
        <h3>No active session</h3>
        <p>Create or select a session to start generating ideas.</p>
      </div>
    );
  }

  // Group ideas by status
  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: ideas.filter((i) => i.status === status),
  }));

  return (
    <div className="stack">
      {/* Toolbar */}
      <div className="row-between">
        <h3 className="text-sm" style={{ margin: 0, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--bb-muted)" }}>
          Ideas & Plans ({ideas.length})
        </h3>
        <div className="row gap-sm">
          {ideas.length > 0 ? (
            <>
              <button className="btn btn-ghost text-sm" title="Select all" onClick={selectAll} type="button">Select all</button>
              <button className="btn btn-ghost text-sm" title="Deselect" onClick={selectNone} type="button">Clear</button>
            </>
          ) : null}
        </div>
      </div>

      {/* Categories */}
      {categories.length > 0 ? (
        <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <span className="idea-category-chip" key={cat.id} title={cat.description}>
              {cat.name}
            </span>
          ))}
        </div>
      ) : null}

      {/* New category input */}
      {showCategoryInput ? (
        <div className="row gap-sm">
          <input
            className="input"
            placeholder="Category name..."
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateCategory(); }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={() => void handleCreateCategory()} type="button">Add</button>
        </div>
      ) : (
        <button className="btn btn-ghost text-sm" onClick={() => setShowCategoryInput(true)} type="button">
          <Plus size={12} /> New category
        </button>
      )}

      {/* Quick add idea */}
      <div className="row gap-sm">
        <input
          className="input"
          placeholder="Add a quick idea..."
          value={newIdeaTitle}
          onChange={(e) => setNewIdeaTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreateIdea(); }}
        />
        <button className="btn btn-primary" disabled={!newIdeaTitle.trim()} onClick={() => void handleCreateIdea()} type="button">
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Ideas grouped by status */}
      {grouped.map((group) =>
        group.items.length === 0 ? null : (
          <div className="idea-section" key={group.status}>
            <h3>{STATUS_LABELS[group.status]} ({group.items.length})</h3>
            {group.items.map((idea) => (
              <div className="idea-card" key={idea.id}>
                <div className="idea-card-header">
                  <button
                    className="btn-icon btn-icon-sm"
                    title={selectedIds.has(idea.id) ? "Deselect" : "Select"}
                    onClick={() => toggleSelect(idea.id)}
                    type="button"
                  >
                    <Check size={12} style={{ opacity: selectedIds.has(idea.id) ? 1 : 0.3 }} />
                  </button>
                  <span className="idea-card-title">{idea.title}</span>
                  <select
                    className="input"
                    style={{ width: "auto", fontSize: "10px", padding: "2px 4px" }}
                    value={idea.status}
                    onChange={(e) => void updateIdeaStatus(idea.id, e.target.value as IdeaStatus)}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <span className={`idea-status ${STATUS_CLASS[idea.status]}`}>{STATUS_LABELS[idea.status]}</span>
                  <button
                    className="btn-icon btn-icon-sm text-danger"
                    title="Delete idea"
                    onClick={() => void removeIdea(idea.id)}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {idea.description ? <p className="idea-card-desc">{idea.description}</p> : null}
              </div>
            ))}
          </div>
        ),
      )}

      {ideas.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={32} className="text-muted" />
          <h3>No ideas yet</h3>
          <p>Add a quick idea above, or use the "Generate Ideas" button to let AI suggest work.</p>
        </div>
      ) : null}
    </div>
  );
}
