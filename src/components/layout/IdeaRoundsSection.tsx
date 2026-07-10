import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Rocket, Sparkles } from "lucide-react";
import type { Idea } from "../../lib/ideas";
import { listIdeaRounds, finishIdeaRound, type IdeaRound } from "../../lib/ideaRounds";
import { batchPromoteIdeas } from "../../lib/plans";

type IdeaRoundsSectionProps = {
  sessionId: string | null;
  /** Live idea catalog — round membership derives from `batchId`. */
  ideas: Idea[];
  onStartRound: () => void;
  /** Called after a successful deploy so the host can refresh and navigate. */
  onDeployed: (createdCount: number, failed: { ideaId: string; error: string }[]) => void;
  onShowToast?: (title: string, detail?: string, kind?: "success" | "warning" | "error" | "info") => void;
};

/**
 * Round history + round review: lists generation rounds (newest first) with
 * live outcome counts, and lets the user review a round's ideas — select and
 * deploy (batch promote into plans) behind one enumerated confirmation.
 */
export function IdeaRoundsSection({ sessionId, ideas, onStartRound, onDeployed, onShowToast }: IdeaRoundsSectionProps) {
  const [rounds, setRounds] = useState<IdeaRound[]>([]);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const refreshRounds = useCallback(() => {
    if (!sessionId) {
      setRounds([]);
      return;
    }
    void listIdeaRounds(sessionId)
      .then(setRounds)
      .catch(() => setRounds([]));
  }, [sessionId]);

  // Refresh when the catalog changes — captures during a running round land
  // as idea rows, so the ideas prop is the live signal.
  useEffect(() => {
    refreshRounds();
  }, [refreshRounds, ideas.length]);

  const roundIdeas = useMemo(
    () => (openRoundId ? ideas.filter((i) => i.batchId === openRoundId) : []),
    [ideas, openRoundId],
  );
  const selectedConcepts = useMemo(
    () => roundIdeas.filter((i) => selected.has(i.id) && i.status === "concept"),
    [roundIdeas, selected],
  );

  const toggleRound = useCallback((roundId: string) => {
    setOpenRoundId((prev) => (prev === roundId ? null : roundId));
    setSelected(new Set());
    setConfirmOpen(false);
  }, []);

  const handleEndRound = useCallback(() => {
    if (!sessionId) return;
    void finishIdeaRound(sessionId)
      .then(() => refreshRounds())
      .catch(() => {});
  }, [sessionId, refreshRounds]);

  const handleDeploy = useCallback(async () => {
    if (!sessionId || selectedConcepts.length === 0) return;
    setDeploying(true);
    setConfirmOpen(false);
    try {
      const result = await batchPromoteIdeas(sessionId, selectedConcepts.map((i) => i.id));
      const failed = result.errors ?? [];
      onDeployed(result.created.length, failed);
      setSelected(new Set());
    } catch (e) {
      onShowToast?.("Deploy failed", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setDeploying(false);
    }
  }, [sessionId, selectedConcepts, onDeployed, onShowToast]);

  const countsFor = useCallback(
    (round: IdeaRound) => {
      const members = ideas.filter((i) => i.batchId === round.id);
      const count = (status: string) => members.filter((i) => i.status === status).length;
      return { captured: members.length, concept: count("concept"), picked: count("picked"), rejected: count("rejected") };
    },
    [ideas],
  );

  return (
    <div className="idea-rounds-section" title="Idea generation rounds">
      <div className="idea-rounds-header">
        <span className="idea-rounds-title">Rounds</span>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          title="Generate ideas — one-click round grounded in the schematic, decision history, and preferences"
          onClick={onStartRound}
        >
          <Sparkles size={11} /> Generate ideas
        </button>
      </div>
      {rounds.length === 0 ? (
        <div className="idea-rounds-empty text-muted text-sm" title="No rounds yet">
          No rounds yet. A round generates grounded ideas without any typing.
        </div>
      ) : (
        rounds.map((round) => {
          const counts = countsFor(round);
          const open = openRoundId === round.id;
          const started = new Date(round.createdAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <div key={round.id} className="idea-round">
              <div
                className="idea-round-row"
                role="button"
                tabIndex={0}
                title={`Round ${round.id} — ${round.status}. ${counts.captured} captured, ${counts.picked} deployed, ${counts.rejected} rejected.`}
                onClick={() => toggleRound(round.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleRound(round.id); }}
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                <span className="idea-round-time">{started}</span>
                <span className={`idea-round-status idea-round-status-${round.status}`}>{round.status}</span>
                <span className="idea-round-counts text-muted">
                  {counts.captured} captured · {counts.picked} deployed · {counts.rejected} rejected
                </span>
                {round.status === "running" ? (
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="End this round — new captures stop being tagged with it"
                    onClick={(e) => { e.stopPropagation(); handleEndRound(); }}
                  >
                    End round
                  </button>
                ) : null}
              </div>
              {open ? (
                <div className="idea-round-review">
                  {roundIdeas.length === 0 ? (
                    <div className="text-muted text-sm" title="No ideas in this round yet">
                      No ideas captured in this round yet.
                    </div>
                  ) : (
                    roundIdeas.map((idea) => (
                      <label key={idea.id} className="idea-round-idea" title={`${idea.title} — ${idea.status}${idea.grounding ? `. Grounding: ${idea.grounding}` : ""}`}>
                        <input
                          type="checkbox"
                          disabled={idea.status !== "concept"}
                          checked={selected.has(idea.id)}
                          title={idea.status === "concept" ? "Select for deploy" : `Already ${idea.status}`}
                          onChange={(e) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(idea.id);
                              else next.delete(idea.id);
                              return next;
                            });
                          }}
                        />
                        <span className="idea-round-idea-title">{idea.title}</span>
                        <span className={`idea-round-idea-status idea-status-${idea.status}`}>{idea.status}</span>
                        {!idea.anchor ? (
                          <span className="idea-round-idea-flag text-muted" title="No schematic anchor — outside current focus">outside focus</span>
                        ) : null}
                      </label>
                    ))
                  )}
                  {selectedConcepts.length > 0 && !confirmOpen ? (
                    <div className="idea-round-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        title={`Deploy ${selectedConcepts.length} idea(s): create one plan per idea and open the Plans stage`}
                        disabled={deploying}
                        onClick={() => setConfirmOpen(true)}
                      >
                        <Rocket size={11} /> Deploy selected ({selectedConcepts.length})
                      </button>
                    </div>
                  ) : null}
                  {confirmOpen ? (
                    <div className="idea-round-confirm" title="Deploy confirmation">
                      <p className="text-sm">
                        Deploy {selectedConcepts.length} idea{selectedConcepts.length > 1 ? "s" : ""}: one plan is created per idea
                        ({selectedConcepts.map((i) => i.title).join(", ")}). Plans start in draft — run them through OpenSpec
                        to reach ready, then launch into chats. Nothing runs yet.
                      </p>
                      <div className="idea-round-actions">
                        <button className="btn btn-sm btn-primary" type="button" title="Create the plans" disabled={deploying} onClick={() => void handleDeploy()}>
                          {deploying ? "Deploying…" : "Confirm deploy"}
                        </button>
                        <button className="btn btn-sm" type="button" title="Cancel — nothing is created" onClick={() => setConfirmOpen(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
