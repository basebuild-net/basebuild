import { useMemo, useState } from "react";
import { Lightbulb, Send, Sparkles, Trash2 } from "lucide-react";

import type { Idea, IdeaStatus } from "../../lib/ideas";
import { SkeletonRows } from "../layout/Loading";
import { t } from "../../i18n";

type IdeaBrowserProps = {
  ideas: Idea[];
  categories: { id: string; name: string }[];
  /** True until the first idea fetch settles — the empty state below is a
   *  false negative while it is set. Pass `useIdeaState().loading`. */
  loading: boolean;
  onPromote: (ideaId: string) => void;
  onSendToChat: (idea: Idea) => void;
  onGenerate: () => void;
  onGenerateForCategory: (categoryId: string | undefined) => void;
  onSetStatus: (ideaId: string, status: IdeaStatus) => void;
  onDelete: (ideaId: string) => void;
};

const STATUS_FILTERS = (): { value: IdeaStatus | "all"; label: string }[] => [
  { value: "all", label: t("ideaBrowser.all") },
  { value: "concept", label: t("ideaBrowser.concept") },
  { value: "picked", label: t("ideaBrowser.picked") },
  { value: "rejected", label: t("ideaBrowser.rejected") },
  { value: "archived", label: t("ideaBrowser.archived") },
];

export function IdeaBrowser({
  ideas,
  categories,
  loading,
  onPromote,
  onSendToChat,
  onGenerate,
  onGenerateForCategory,
  onSetStatus,
  onDelete,
}: IdeaBrowserProps) {
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | "all">("all");

  const filteredIdeas = useMemo(() => {
    return ideas
      .filter((idea) => statusFilter === "all" || idea.status === statusFilter)
      .filter((idea) => categoryFilter === "all" || idea.categoryId === categoryFilter)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [ideas, statusFilter, categoryFilter]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, Idea[]>();
    for (const idea of filteredIdeas) {
      const key = idea.categoryId ?? "uncategorized";
      const arr = groups.get(key) ?? [];
      arr.push(idea);
      groups.set(key, arr);
    }
    return groups;
  }, [filteredIdeas]);

  return (
    <div className="idea-browser">
      <div className="idea-browser-header">
        <span className="idea-browser-title">
          <Lightbulb size={12} /> {t("ideaBrowser.ideas", { ideasCount: ideas.length })}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          title={t("ideaBrowser.quickFreeformIdeaGeneration")}
          onClick={onGenerate}
        >
          <Sparkles size={11} /> {t("ideaBrowser.generate")}
        </button>
      </div>

      <div className="idea-browser-filters">
        <div className="idea-browser-filter-group">
          {STATUS_FILTERS().map((f) => (
            <button
              key={f.value}
              type="button"
              className={`idea-browser-filter${statusFilter === f.value ? " is-active" : ""}`}
              title={t("ideaBrowser.filter", { label: f.label })}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {categories.length > 0 ? (
          <select
            className="idea-browser-category-select"
            title={t("ideaBrowser.filterByCategory")}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">{t("ideaBrowser.allCategories")}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <div className="idea-browser-gen-actions">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="btn btn-sm"
              title={t("ideaBrowser.generateIdeasFor", { name: cat.name })}
              onClick={() => onGenerateForCategory(cat.id)}
            >
              {cat.name}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-sm"
            title={t("ideaBrowser.freeformGenerationNoCategory")}
            onClick={() => onGenerateForCategory(undefined)}
          >
            {t("ideaBrowser.freeform")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <SkeletonRows rows={4} label={t("ideaBrowser.loadingIdeas")} />
      ) : filteredIdeas.length === 0 ? (
        <div className="idea-browser-empty">
          <Lightbulb size={20} />
          <p>{statusFilter === "all" ? t("ideaBrowser.noIdeasYetGenerate") : t("ideaBrowser.noIdeasInGenerate", { statusFilter: statusFilter })}</p>
        </div>
      ) : (
        <ul className="idea-browser-list">
          {Array.from(groupedByCategory.entries()).map(([catKey, groupIdeas]) => {
            const cat = categories.find((c) => c.id === catKey);
            const catName = cat?.name ?? (catKey === "uncategorized" ? t("ideaBrowser.uncategorized") : catKey);
            return (
              <li key={catKey} className="idea-browser-group">
                <div className="idea-browser-group-name">{catName}</div>
                <ul className="idea-browser-group-list">
                  {groupIdeas.map((idea) => (
                    <li key={idea.id} className={`idea-browser-item chat-idea-status-${idea.status}`}>
                      <span className="idea-browser-item-title" title={idea.description}>{idea.title}</span>
                      <div className="idea-browser-item-actions">
                        {idea.status === "concept" ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title={t("ideaBrowser.promoteToPlan")}
                            onClick={() => onPromote(idea.id)}
                          >
                            {t("ideaBrowser.promote")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-icon btn-icon-sm"
                          title={t("ideaBrowser.sendToChat")}
                          onClick={() => onSendToChat(idea)}
                        >
                          <Send size={10} />
                        </button>
                        {idea.status !== "archived" ? (
                          <button
                            type="button"
                            className="btn-icon btn-icon-sm"
                            title={t("ideaBrowser.archive")}
                            onClick={() => onSetStatus(idea.id, "archived")}
                          >
                            <Trash2 size={10} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
