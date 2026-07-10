import { useState } from "react";
import { Check, ChevronRight, Lightbulb, Plus, Trash2 } from "lucide-react";

import { useIdeaState } from "../../state/ideas";
import type { IdeaStatus } from "../../lib/ideas";

const STATUS_LABELS: Record<IdeaStatus, string> = {
  concept: "Concept",
  picked: "Picked",
  rejected: "Rejected",
  archived: "Archived",
};

const STATUS_CLASS: Record<IdeaStatus, string> = {
  concept: "is-concept",
  picked: "is-picked",
  rejected: "is-rejected",
  archived: "is-archived",
};

const STATUS_ORDER: IdeaStatus[] = ["concept", "picked", "rejected", "archived"];

type IdeasPanelProps = {
  sessionId: string | null;
};

export function IdeasPanel({ sessionId }: IdeasPanelProps) {
  const { ideas, categories, createIdea, updateIdeaStatus, removeIdea, createCategory, promoteIdeas } = useIdeaState(sessionId);
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

  async function promoteSelected() {
    if (selectedIds.size === 0 || !sessionId) return;
    try {
      await promoteIdeas(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (e) {
      console.error("Failed to promote ideas:", e);
    }
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
        <h3 className="text-sm ideas-header-label">
          Ideas & Plans ({ideas.length})
        </h3>
        <div className="row gap-sm">
          {ideas.length > 0 ? (
            <>
              <button className="btn btn-ghost text-sm" title="Select all" onClick={selectAll} type="button">Select all</button>
              <button className="btn btn-ghost text-sm" title="Deselect" onClick={selectNone} type="button">Clear</button>
              {selectedIds.size > 0 ? (
                <button
                  className="btn btn-primary text-sm"
                  title="Promote selected ideas to draft plans"
                  onClick={() => void promoteSelected()}
                  type="button"
                >
                  Promote ({selectedIds.size})
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Categories */}
      {categories.length > 0 ? (
        <div className="row gap-sm flex-wrap">
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
          <button className="btn btn-primary" title="Add category" onClick={() => void handleCreateCategory()} type="button">Add</button>
        </div>
      ) : (
        <button className="btn btn-ghost text-sm" title="Create new category" onClick={() => setShowCategoryInput(true)} type="button">
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
        <button className="btn btn-primary" title="Add idea" disabled={!newIdeaTitle.trim()} onClick={() => void handleCreateIdea()} type="button">
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
                    <Check size={12} className={selectedIds.has(idea.id) ? "check-icon-selected" : "check-icon-unselected"} />
                  </button>
                  <span className="idea-card-title">{idea.title}</span>
                  <select
                    className="input select-auto-compact"
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
