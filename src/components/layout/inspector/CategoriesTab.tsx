import type { Dispatch, SetStateAction } from "react";
import { FolderTree, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { Idea, IdeaCategory } from "../../../lib/ideas";
import type { IdeaStateValue } from "../../../state/ideas";
import { Disclosure } from "../../Disclosure";
import { SkeletonRows } from "../Loading";
import { t } from "../../../i18n";

type CategoriesTabProps = {
  selectedCategory: IdeaCategory | null;
  setSelectedCategory: Dispatch<SetStateAction<IdeaCategory | null>>;
  onSuggestForCategory?: (category: IdeaCategory | null) => void;
  categoryIdeas: Idea[];
  newCategoryName: string;
  setNewCategoryName: Dispatch<SetStateAction<string>>;
  newCategoryDesc: string;
  setNewCategoryDesc: Dispatch<SetStateAction<string>>;
  handleCreateCategory: () => void;
  onGenerateCategories?: () => void;
  ideaState: IdeaStateValue;
};

export function CategoriesTab({
  selectedCategory,
  setSelectedCategory,
  onSuggestForCategory,
  categoryIdeas,
  newCategoryName,
  setNewCategoryName,
  newCategoryDesc,
  setNewCategoryDesc,
  handleCreateCategory,
  onGenerateCategories,
  ideaState,
}: CategoriesTabProps) {
  return (
    <div className="inspector-categories stack">
      {selectedCategory ? (
        <div className="inspector-category-detail stack">
          <button
            className="btn btn-sm"
            type="button"
            title={t("categoriesTab.backToCategories")}
            onClick={() => setSelectedCategory(null)}
          >
            {t("categoriesTab.back")}
          </button>
          <div className="inspector-category-header">
            <span className="inspector-category-name">{selectedCategory.name}</span>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title={t("categoriesTab.suggestMoreIdeasFor", { name: selectedCategory.name })}
              onClick={() => onSuggestForCategory?.(selectedCategory)}
            >
              <Sparkles size={11} /> {t("categoriesTab.suggestMoreIdeas")}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={t("categoriesTab.regenerateIdeasFor", { name: selectedCategory.name })}
              onClick={() => onSuggestForCategory?.(selectedCategory)}
            >
              <RefreshCw size={11} /> {t("categoriesTab.regenerate")}
            </button>
          </div>
          {categoryIdeas.length === 0 ? (
            <p className="text-muted text-sm">{t("categoriesTab.noIdeasInThisCategory")}</p>
          ) : (
            categoryIdeas.map((idea) => (
              <div key={idea.id} className={`chat-idea-card chat-idea-status-${idea.status}`}>
                <div className="chat-idea-card-top">
                  <span className="chat-idea-title">{idea.title}</span>
                  <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                    {idea.status === "picked" ? t("categoriesTab.planned") : idea.status === "rejected" ? t("categoriesTab.rejected") : idea.status}
                  </span>
                </div>
                {idea.description ? <p className="chat-idea-desc">{idea.description}</p> : null}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="inspector-category-add stack">
            <Disclosure
              label={<><Plus size={11} /> {t("categoriesTab.addCategory")}</>}
              title={t("categoriesTab.manuallyAddAnIdeaCategory")}
            >
              <input
                className="input"
                type="text"
                placeholder={t("categoriesTab.categoryName")}
                title={t("categoriesTab.categoryName")}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <input
                className="input"
                type="text"
                placeholder={t("categoriesTab.descriptionOptional")}
                title={t("categoriesTab.categoryDescription")}
                value={newCategoryDesc}
                onChange={(e) => setNewCategoryDesc(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                type="button"
                title={t("categoriesTab.addACategoryManually")}
                onClick={handleCreateCategory}
              >
                <Plus size={11} /> {t("categoriesTab.addCategory")}
              </button>
            </Disclosure>
            <button
              className="btn btn-sm"
              type="button"
              title={t("categoriesTab.generateCategoriesFromTheProject")}
              onClick={() => onGenerateCategories?.() ?? onSuggestForCategory?.(null)}
            >
              <Sparkles size={11} /> {t("categoriesTab.generateCategoriesFromProject")}
            </button>
          </div>
          {ideaState.loading ? (
            <SkeletonRows rows={3} label={t("categoriesTab.loadingCategories")} />
          ) : ideaState.categories.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <FolderTree size={24} />
              <p className="text-muted text-sm">{t("categoriesTab.noCategoriesYet")}</p>
            </div>
          ) : (
            <div className="inspector-category-list">
              {ideaState.categories.map((cat) => (
                <button
                  key={cat.id}
                  className="inspector-category-card"
                  type="button"
                  title={t("categoriesTab.open", { name: cat.name })}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <div className="inspector-category-card-top">
                    <span className="inspector-category-card-name">{cat.name}</span>
                    <span className="inspector-category-card-count">
                      {ideaState.ideas.filter((i) => i.categoryId === cat.id).length}
                    </span>
                  </div>
                  {cat.description ? <p className="inspector-category-card-desc text-muted text-sm">{cat.description}</p> : null}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
