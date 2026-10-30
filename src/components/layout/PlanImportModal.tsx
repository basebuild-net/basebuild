import { useCallback, useEffect, useState } from "react";
import { useEscapeKey } from "../../lib/useEscapeKey";
import { Download, X } from "lucide-react";
import type { PlanImportCandidate, PlanImportResult } from "../../lib/planImport";
import { planImportApply, planImportDetect } from "../../lib/planImport";
import { useLogs } from "../../state/log";
import { ModalPortal } from "../ModalPortal";
import { SkeletonRows } from "./Loading";
import { t } from "../../i18n";

type PlanImportModalProps = {
  projectPath: string | null;
  onClose: () => void;
};

export function PlanImportModal({ projectPath, onClose }: PlanImportModalProps) {
  const [candidates, setCandidates] = useState<PlanImportCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Detection starts on mount, so the first paint must not claim "No
  // importable plans found".
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<PlanImportResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(true, onClose);
  const { addLog } = useLogs();

  const detect = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const found = await planImportDetect(projectPath);
      setCandidates(found);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void detect();
  }, [detect]);

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (!projectPath || selected.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const slugs = [...selected];
      const res = await planImportApply(projectPath, slugs);
      setResults(res);
      addLog("info", `Imported ${res.filter((r) => !r.skipped).length} plan(s)`, slugs.join(", "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const importedCount = results?.filter((r) => !r.skipped).length ?? 0;
  const skippedCount = results?.filter((r) => r.skipped).length ?? 0;

  return (
    <ModalPortal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-plan-import" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t("planImportModal.importPlans")}</span>
          <button
            className="btn-icon"
            title={t("planImportModal.close")}
            type="button"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {!projectPath ? (
            <p className="text-muted text-sm">{t("planImportModal.openAProjectToDetect")}</p>
          ) : loading && !results ? (
            <SkeletonRows rows={3} label={t("planImportModal.detectingImportablePlans")} />
          ) : results ? (
            <div className="stack">
              <p className="text-sm">
                {t(importedCount === 1 ? "planImportModal.importedOne" : "planImportModal.importedMany", { count: importedCount, skipped: skippedCount > 0 ? t("planImportModal.skipped3", { skippedCount: skippedCount }) : "" })}
              </p>
              <ul className="import-results">
                {results.map((r) => (
                  <li key={r.slug} className="import-result">
                    <span className="import-result-slug">{r.slug}</span>
                    {r.skipped ? (
                      <span className="import-result-badge is-skipped" title={r.warning ?? t("planImportModal.skipped2")}>
                        {t("planImportModal.skipped")}
                      </span>
                    ) : (
                      <span className="import-result-badge is-ok">{t("planImportModal.imported")}</span>
                    )}
                    {r.warning ? (
                      <span className="import-result-warning" title={r.warning}>⚠</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button
                className="btn btn-sm"
                type="button"
                title={t("planImportModal.detectAgain")}
                onClick={() => {
                  setResults(null);
                  void detect();
                }}
              >
                {t("planImportModal.detectAgain")}
              </button>
            </div>
          ) : error ? (
            <div className="stack">
              <p className="text-error text-sm">{error}</p>
              <button className="btn btn-sm" type="button" title={t("planImportModal.retry")} onClick={() => void detect()}>
                {t("planImportModal.retry")}
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-muted text-sm">
              {t("planImportModal.noImportablePlansFoundUnexecuted")}
              <code> {t("planImportModal.openspecChanges")}</code> {t("planImportModal.thatArenTLinkedTo")}
            </p>
          ) : (
            <>
              <p className="text-muted text-sm">
                {t(candidates.length === 1 ? "planImportModal.candidatesOne" : "planImportModal.candidatesMany", { count: candidates.length })}
              </p>
              <ul className="import-candidate-list">
                {candidates.map((c) => {
                  const checked = selected.has(c.slug);
                  return (
                    <li
                      key={c.slug}
                      className={`import-candidate${checked ? " is-selected" : ""}`}
                    >
                      <label className="import-candidate-label" title={c.external}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(c.slug)}
                        />
                        <span className="import-candidate-title">{c.title}</span>
                        <span className="import-candidate-meta">
                          {t((c.warning ? "planImportModal.tasks.empty" : "planImportModal.tasks.none"), { engine: c.engine, completed: c.completed, total: c.total })}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {candidates.length > 0 && !results ? (
          <div className="modal-footer">
            <button
              className="btn"
              type="button"
              title={t("planImportModal.cancel")}
              onClick={onClose}
            >
              {t("planImportModal.cancel")}
            </button>
            <button
              className="btn btn-primary"
              type="button"
              title={t("planImportModal.importSelectedPlans")}
              disabled={selected.size === 0 || loading}
              onClick={() => void handleImport()}
            >
              <Download size={14} />
              {t("planImportModal.import", { value: selected.size > 0 ? `(${selected.size})` : "" })}</button>
          </div>
        ) : null}
      </div>
    </div>
    </ModalPortal>
  );
}
