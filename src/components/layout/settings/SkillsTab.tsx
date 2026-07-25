import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ModalPortal } from "../../ModalPortal";
import { listResolvedSkills, readResolvedSkill, type ResolvedSkill } from "../../../lib/skillRegistry";
import { LoadingBlock, SkeletonRows } from "../Loading";

export function SkillsTab() {
  const [skills, setSkills] = useState<ResolvedSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<ResolvedSkill | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listResolvedSkills();
        setSkills(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load skills");
      }
    })();
  }, []);

  useEffect(() => {
    if (!previewSkill) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPreviewSkill(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewSkill]);

  async function openPreview(skill: ResolvedSkill) {
    setPreviewSkill(skill);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    try {
      const content = await readResolvedSkill(skill.name);
      setPreviewContent(content);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Failed to load skill content");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="stack">
      <h3>Skills</h3>
      <p className="text-muted text-sm">Resolved skills available to the agent loop.</p>
      {error ? (
        <p className="text-danger text-sm">{error}</p>
      ) : skills === null ? (
        <SkeletonRows rows={4} label="Loading skills…" />
      ) : skills.length === 0 ? (
        <p className="text-muted text-sm">No skills resolved. Bundled skills provision on first run.</p>
      ) : (
        <div className="skills-list">
          {skills.map((skill) => (
            <div key={skill.name} className="skill-row">
              <div className="skill-row-name" title={skill.path}>{skill.name}</div>
              <div className="skill-row-desc">{skill.description}</div>
              <span className={`skill-badge skill-badge-${skill.source}`}>{skill.source}</span>
              <span className="skill-badge">{skill.runtime}</span>
              <button
                className="btn btn-sm"
                type="button"
                title="Preview skill content"
                onClick={() => void openPreview(skill)}
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}

      {previewSkill ? (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setPreviewSkill(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{previewSkill.name}</h3>
              <button
                className="btn-icon"
                type="button"
                title="Close preview"
                onClick={() => setPreviewSkill(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {previewLoading ? (
                <LoadingBlock label="Loading skill…" compact />
              ) : previewError ? (
                <p className="text-danger text-sm">{previewError}</p>
              ) : (
                <pre className="skill-preview-content">{previewContent ?? ""}</pre>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
