import { useState } from "react";
import { Check, ChevronRight, Lightbulb, Plus, Trash2 } from "lucide-react";

import { useIdeaState } from "../../state/ideas";
import type { IdeaStatus } from "../../lib/ideas";

import { OptionList, type OptionListOption } from "../layout/OptionList";
import { SkeletonRows, SkeletonText } from "../layout/Loading";
import { t } from "../../i18n";
const STATUS_LABELS: Record<IdeaStatus, string> = {
  concept: t("ideasPanel.concept"),
  picked: t("ideasPanel.picked"),
  rejected: t("ideasPanel.rejected"),
  archived: t("ideasPanel.archived"),
};

const STATUS_CLASS: Record<IdeaStatus, string> = {
  concept: "is-concept",
  picked: "is-picked",
  rejected: "is-rejected",
  archived: "is-archived",
};

const STATUS_OPTION_ITEMS = (): OptionListOption<IdeaStatus>[] => [
  { id: "concept", label: STATUS_LABELS.concept, title: t("ideasPanel.ideaIsStillAConcept") },
  { id: "picked", label: STATUS_LABELS.picked, title: t("ideasPanel.ideaHasBeenPickedForPlanning") },
  { id: "rejected", label: STATUS_LABELS.rejected, title: t("ideasPanel.ideaHasBeenRejected") },
  { id: "archived", label: STATUS_LABELS.archived, title: t("ideasPanel.ideaHasBeenArchived") },
];
const STATUS_ORDER: IdeaStatus[] = ["concept", "picked", "rejected", "archived"];

type IdeasPanelProps = {
  sessionId: string | null;
};

export function IdeasPanel({ sessionId }: IdeasPanelProps) {
  const { ideas, categories, loading, createIdea, updateIdeaStatus, removeIdea, createCategory, promoteIdeas } = useIdeaState(sessionId);
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
        <h3>{t("ideasPanel.noActiveSession")}</h3>
        <p>{t("ideasPanel.createOrSelectASession")}</p>
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
          {t("ideasPanel.ideasPlans", { ideasCount: ideas.length })}
        </h3>
        <div className="row gap-sm">
          {ideas.length > 0 ? (
            <>
              <button className="btn btn-ghost text-sm" title={t("ideasPanel.selectAll")} onClick={selectAll} type="button">{t("ideasPanel.selectAll")}</button>
              <button className="btn btn-ghost text-sm" title={t("ideasPanel.deselect")} onClick={selectNone} type="button">{t("ideasPanel.clear")}</button>
              {selectedIds.size > 0 ? (
                <button
                  className="btn btn-primary text-sm"
                  title={t("ideasPanel.promoteSelectedIdeasToDraft")}
                  onClick={() => void promoteSelected()}
                  type="button"
                >
                  {t("ideasPanel.promote", { size: selectedIds.size })}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* Categories */}
      {loading ? (
        <div className="row gap-sm flex-wrap">
          <SkeletonText width={10} />
          <SkeletonText width={8} />
        </div>
      ) : categories.length > 0 ? (
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
            placeholder={t("ideasPanel.categoryName")}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateCategory(); }}
            autoFocus
          />
          <button className="btn btn-primary" title={t("ideasPanel.addCategory")} onClick={() => void handleCreateCategory()} type="button">{t("ideasPanel.add")}</button>
        </div>
      ) : (
        <button className="btn btn-ghost text-sm" title={t("ideasPanel.createNewCategory")} onClick={() => setShowCategoryInput(true)} type="button">
          <Plus size={12} /> {t("ideasPanel.newCategory")}
        </button>
      )}

      {/* Quick add idea */}
      <div className="row gap-sm">
        <input
          className="input"
          placeholder={t("ideasPanel.addAQuickIdea")}
          value={newIdeaTitle}
          onChange={(e) => setNewIdeaTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleCreateIdea(); }}
        />
        <button className="btn btn-primary" title={t("ideasPanel.addIdea")} disabled={!newIdeaTitle.trim()} onClick={() => void handleCreateIdea()} type="button">
          <Plus size={12} /> {t("ideasPanel.add")}
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
                    title={selectedIds.has(idea.id) ? t("ideasPanel.deselect") : t("ideasPanel.select")}
                    onClick={() => toggleSelect(idea.id)}
                    type="button"
                  >
                    <Check size={12} className={selectedIds.has(idea.id) ? "check-icon-selected" : "check-icon-unselected"} />
                  </button>
                  <span className="idea-card-title">{idea.title}</span>
                  <OptionList
                    value={idea.status}
                    options={STATUS_OPTION_ITEMS()}
                    onChange={(id) => void updateIdeaStatus(idea.id, id)}
                    label={t("ideasPanel.ideaStatus")}
                    compact
                  />
                  <span className={`idea-status ${STATUS_CLASS[idea.status]}`}>{STATUS_LABELS[idea.status]}</span>
                  <button
                    className="btn-icon btn-icon-sm text-danger"
                    title={t("ideasPanel.deleteIdea")}
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

      {loading ? (
        <SkeletonRows rows={3} label={t("ideasPanel.loadingIdeas")} />
      ) : ideas.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={32} className="text-muted" />
          <h3>{t("ideasPanel.noIdeasYet")}</h3>
          <p>{t("ideasPanel.addAQuickIdeaAbove")}</p>
        </div>
      ) : null}
    </div>
  );
}
