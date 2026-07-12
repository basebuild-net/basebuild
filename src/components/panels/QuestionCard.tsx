import { useState } from "react";
import { Check, X } from "lucide-react";
import { nativeInteractionResolve, nativeInteractionCancel } from "../../lib/interactions";
import type { PendingInteraction, Question, QuestionAnswer } from "../../lib/interactions";

type QuestionCardProps = {
  interaction: PendingInteraction;
  onResolved?: (interaction: PendingInteraction) => void;
  onCancelled?: (interactionId: string) => void;
};

/// Renders a pending ask_user interaction as an inline card in the chat
/// stream. Options render as buttons (recommended marked), multi-select
/// with a confirm button, confirm kind as two buttons, text kind as an
/// inline input. Answered and cancelled states render compactly.
export function QuestionCard({ interaction, onResolved, onCancelled }: QuestionCardProps) {
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = interaction.status === "pending";

  function ensureAnswer(q: Question): QuestionAnswer {
    return (
      answers[q.id] ?? {
        questionId: q.id,
        selected: q.kind === "multi" ? [] : undefined,
        text: undefined,
      }
    );
  }

  function toggleOption(q: Question, label: string) {
    const cur = ensureAnswer(q);
    if (q.kind === "options" || q.kind === "confirm") {
      setAnswers((prev) => ({ ...prev, [q.id]: { ...cur, selected: [label] } }));
    } else if (q.kind === "multi") {
      const sel = cur.selected ?? [];
      const next = sel.includes(label) ? sel.filter((s) => s !== label) : [...sel, label];
      setAnswers((prev) => ({ ...prev, [q.id]: { ...cur, selected: next } }));
    }
  }

  function setText(q: Question, text: string) {
    const cur = ensureAnswer(q);
    setAnswers((prev) => ({ ...prev, [q.id]: { ...cur, text } }));
  }

  async function handleResolve() {
    setResolving(true);
    setError(null);
    try {
      const answerList = interaction.questions.map((q) => ensureAnswer(q));
      const resolved = await nativeInteractionResolve(interaction.id, answerList);
      onResolved?.(resolved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  }

  async function handleCancel() {
    setResolving(true);
    setError(null);
    try {
      await nativeInteractionCancel(interaction.id);
      onCancelled?.(interaction.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  }

  // Compact answered/cancelled state.
  if (!isPending) {
    const statusLabel = interaction.status === "answered" ? "Answered" : "Cancelled";
    const statusClass = interaction.status === "answered" ? "success" : "muted";
    return (
      <div className={`question-card question-card-${statusClass}`} title={`Interaction ${interaction.id}`}>
        <div className="question-card-header">
          <span className="question-card-icon">?</span>
          <span className="question-card-status">{statusLabel}</span>
        </div>
        <div className="question-card-body">
          {interaction.questions.map((q) => (
            <div key={q.id} className="question-card-answered">
              <span className="question-card-prompt text-muted">{q.prompt}</span>
              <span className="question-card-answer">{formatAnswer(q, interaction.answers)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Pending: render interactive questions.
  return (
    <div className="question-card question-card-pending" title={`Interaction ${interaction.id}`}>
      <div className="question-card-header">
        <span className="question-card-icon">?</span>
        <span className="question-card-status">Agent is asking</span>
      </div>
      <div className="question-card-body">
        {interaction.questions.map((q, qi) => {
          const cur = ensureAnswer(q);
          const selected = cur.selected ?? [];
          const hasOptions = q.kind === "options" || q.kind === "multi" || q.kind === "confirm";
          return (
            <div key={q.id} className="question-card-question">
              <div className="question-card-prompt">{qi + 1}. {q.prompt}</div>
              {q.detail ? (
                <pre className="question-card-detail" title="Prefilled content — review before confirming">{q.detail}</pre>
              ) : null}
              {hasOptions ? (
                <div className="question-card-options">
                  {q.options?.map((opt, oi) => {
                    const isSel = selected.includes(opt.label);
                    const isRec = q.recommended === oi;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        className={`btn btn-sm question-card-option ${isSel ? "btn-primary" : ""} ${isRec ? "question-card-recommended" : ""}`}
                        title={opt.description ?? opt.label}
                        onClick={() => toggleOption(q, opt.label)}
                      >
                        {opt.label}{isRec ? " ★" : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {/* Every question also accepts a typed custom answer. */}
              <div className="question-card-input-wrap">
                <span className="question-card-input-label">
                  {hasOptions ? "Or type a custom answer" : "Your answer"}
                </span>
                <input
                  type="text"
                  className="question-card-input"
                  placeholder={hasOptions ? "Type a custom answer…" : "Type your answer…"}
                  value={cur.text ?? ""}
                  onChange={(e) => setText(q, e.target.value)}
                  title={`Answer for: ${q.prompt}`}
                />
              </div>
            </div>
          );
        })}
        {error ? <div className="question-card-error text-error">{error}</div> : null}
        <div className="question-card-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            title="Submit answers to the agent"
            disabled={resolving}
            onClick={handleResolve}
          >
            <Check size={14} /> Submit
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Cancel this interaction (agent receives a cancellation notice)"
            disabled={resolving}
            onClick={handleCancel}
          >
            <X size={14} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAnswer(q: Question, answers: unknown): string {
  if (!answers || typeof answers !== "object") return "—";
  // The backend persists answers as an array of QuestionAnswer; tolerate an
  // id-keyed map too for forward/backward compatibility.
  const a = Array.isArray(answers)
    ? (answers as QuestionAnswer[]).find((x) => x?.questionId === q.id)
    : (answers as Record<string, QuestionAnswer>)[q.id];
  if (!a) return "—";
  const parts: string[] = [];
  if (a.selected && a.selected.length > 0) parts.push(a.selected.join(", "));
  if (a.text && a.text.trim()) parts.push(a.text.trim());
  return parts.length > 0 ? parts.join(" — ") : "—";
}
