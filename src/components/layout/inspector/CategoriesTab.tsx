import type { Dispatch, SetStateAction } from "react";
import { FolderTree, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { Idea, IdeaCategory } from "../../../lib/ideas";
import type { IdeaStateValue } from "../../../state/ideas";
import { Disclosure } from "../../Disclosure";
import { SkeletonRows } from "../Loading";

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
            title="Back to categories"
            onClick={() => setSelectedCategory(null)}
          >
            ← Back
          </button>
          <div className="inspector-category-header">
            <span className="inspector-category-name">{selectedCategory.name}</span>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              title={`Suggest more ideas for ${selectedCategory.name}`}
              onClick={() => onSuggestForCategory?.(selectedCategory)}
            >
              <Sparkles size={11} /> Suggest more ideas
            </button>
            <button
              className="btn btn-sm"
              type="button"
              title={`Regenerate ideas for ${selectedCategory.name}`}
              onClick={() => onSuggestForCategory?.(selectedCategory)}
            >
              <RefreshCw size={11} /> Regenerate
            </button>
          </div>
          {categoryIdeas.length === 0 ? (
            <p className="text-muted text-sm">No ideas in this category yet.</p>
          ) : (
            categoryIdeas.map((idea) => (
              <div key={idea.id} className={`chat-idea-card chat-idea-status-${idea.status}`}>
                <div className="chat-idea-card-top">
                  <span className="chat-idea-title">{idea.title}</span>
                  <span className={`chat-idea-status ${idea.status === "rejected" ? "is-rejected" : ""}`}>
                    {idea.status === "picked" ? "Planned" : idea.status === "rejected" ? "Rejected" : idea.status}
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
              label={<><Plus size={11} /> Add category</>}
              title="Manually add an idea category"
            >
              <input
                className="input"
                type="text"
                placeholder="Category name"
                title="Category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <input
                className="input"
                type="text"
                placeholder="Description (optional)"
                title="Category description"
                value={newCategoryDesc}
                onChange={(e) => setNewCategoryDesc(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                type="button"
                title="Add a category manually"
                onClick={handleCreateCategory}
              >
                <Plus size={11} /> Add category
              </button>
            </Disclosure>
            <button
              className="btn btn-sm"
              type="button"
              title="Generate categories from the project schematic"
              onClick={() => onGenerateCategories?.() ?? onSuggestForCategory?.(null)}
            >
              <Sparkles size={11} /> Generate categories from project
            </button>
          </div>
          {ideaState.loading ? (
            <SkeletonRows rows={3} label="Loading categories…" />
          ) : ideaState.categories.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <FolderTree size={24} />
              <p className="text-muted text-sm">No categories yet.</p>
            </div>
          ) : (
            <div className="inspector-category-list">
              {ideaState.categories.map((cat) => (
                <button
                  key={cat.id}
                  className="inspector-category-card"
                  type="button"
                  title={`Open ${cat.name}`}
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
