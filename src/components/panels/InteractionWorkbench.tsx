import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, HelpCircle, Minus, X } from "lucide-react";
import {
  nativeInteractionCancel,
  nativeInteractionResolve,
  nativeInteractionSaveDraft,
  type PendingInteraction,
  type Question,
  type QuestionAnswer,
} from "../../lib/interactions";
import { WorkbenchShell } from "./WorkbenchShell";

type InteractionWorkbenchProps = {
  interaction: PendingInteraction;
  readOnly?: boolean;
  onResolved?: (interaction: PendingInteraction) => void;
  onCancelled?: (interactionId: string) => void;
  onMinimize?: () => void;
  onClose?: () => void;
  onAction?: (action: string, detail: string) => void;
  onDraftChange?: (answers: QuestionAnswer[], currentPage: number) => void;
};

type QuestionPage = {
  id: string;
  title?: string;
  description?: string;
  questions: Question[];
};

type QuestionControlsProps = {
  question: Question;
  answer: QuestionAnswer;
  readOnly: boolean;
  autoFocus?: boolean;
  onChange: (answer: QuestionAnswer) => void;
};

function answersById(source: unknown): Record<string, QuestionAnswer> {
  if (Array.isArray(source)) {
    return Object.fromEntries(
      (source as QuestionAnswer[])
        .filter((answer) => answer && typeof answer.questionId === "string")
        .map((answer) => [answer.questionId, answer]),
    );
  }
  if (source && typeof source === "object") return source as Record<string, QuestionAnswer>;
  return {};
}

function pagesFor(questions: Question[]): QuestionPage[] {
  if (!questions.some((question) => question.pageId)) {
    return [{ id: "default", questions }];
  }
  const pages: QuestionPage[] = [];
  for (const question of questions) {
    const id = question.pageId ?? "default";
    const current = pages[pages.length - 1];
    if (!current || current.id !== id) {
      pages.push({
        id,
        title: question.pageTitle,
        description: question.pageDescription,
        questions: [question],
      });
    } else {
      current.questions.push(question);
    }
  }
  return pages;
}

function emptyAnswer(question: Question): QuestionAnswer {
  return { questionId: question.id, selected: [], text: undefined, value: undefined };
}

function hasAnswer(question: Question, answer: QuestionAnswer | undefined): boolean {
  if (!answer) return false;
  if (question.kind === "rating") return typeof answer.value === "number";
  if (question.kind === "text") return Boolean(answer.text?.trim());
  return Boolean(answer.selected?.length || (question.allowFreeText && answer.text?.trim()));
}

export function formatInteractionAnswer(question: Question, source: unknown): string {
  const answer = answersById(source)[question.id];
  if (!answer) return "—";
  const parts: string[] = [];
  if (answer.selected?.length) parts.push(answer.selected.join(", "));
  if (answer.text?.trim()) parts.push(answer.text.trim());
  if (typeof answer.value === "number") parts.push(String(answer.value));
  return parts.length ? parts.join(" — ") : "—";
}

export function QuestionControls({
  question,
  answer,
  readOnly,
  autoFocus,
  onChange,
}: QuestionControlsProps) {
  if (readOnly) {
    return <div className="interaction-answer-value">{formatInteractionAnswer(question, [answer])}</div>;
  }

  const selected = answer.selected ?? [];
  const hasOptions = question.kind === "options" || question.kind === "multi" || question.kind === "confirm";
  const setSelected = (label: string) => {
    if (question.kind === "multi") {
      const next = selected.includes(label)
        ? selected.filter((value) => value !== label)
        : [...selected, label];
      onChange({ ...answer, selected: next });
      return;
    }
    onChange({ ...answer, selected: [label] });
  };

  return (
    <div className="interaction-question-controls">
      {hasOptions ? (
        <div className="interaction-option-grid" role={question.kind === "multi" ? "group" : "radiogroup"} aria-label={question.prompt}>
          {question.options?.map((option, index) => {
            const active = selected.includes(option.label);
            const recommended = question.recommended === index;
            return (
              <button
                key={option.label}
                type="button"
                className={`interaction-option${active ? " is-selected" : ""}${recommended ? " is-recommended" : ""}`}
                aria-pressed={active}
                title={option.description ?? `Choose ${option.label}`}
                onClick={() => setSelected(option.label)}
              >
                <span>{option.label}</span>
                {recommended ? <span className="interaction-option-recommended">Recommended</span> : null}
                {option.description ? <span className="interaction-option-description">{option.description}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {question.kind === "rating" ? (() => {
        const min = question.scale?.min ?? 1;
        const max = question.scale?.max ?? 5;
        const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
        const stars = (question.scale?.style ?? "stars") === "stars";
        return (
          <div className="interaction-rating-wrap">
            <div className="interaction-rating" role="radiogroup" aria-label={question.prompt}>
              {values.map((value) => (
                <label
                  key={value}
                  className={`interaction-rating-choice${answer.value === value ? " is-selected" : ""}`}
                  title={`Rate ${value} of ${max}`}
                >
                  <input
                    type="radio"
                    name={`rating-${question.id}`}
                    aria-label={`${value} of ${max}`}
                    title={`Rate ${value} of ${max}`}
                    checked={answer.value === value}
                    onChange={() => onChange({ ...answer, value })}
                  />
                  <span aria-hidden="true">{stars ? "★" : value}</span>
                </label>
              ))}
            </div>
            <div className="interaction-rating-labels">
              <span>{question.scale?.lowLabel ?? min}</span>
              <span>{question.scale?.highLabel ?? max}</span>
            </div>
          </div>
        );
      })() : null}

      {question.kind === "text" || hasOptions ? (
        <label className="interaction-text-answer">
          <span>{hasOptions ? "Or write your own answer" : "Your answer"}</span>
          {question.multiline ? (
            <textarea
              autoFocus={autoFocus}
              className="input interaction-answer-input"
              rows={4}
              value={answer.text ?? ""}
              placeholder="Type your answer…"
              title={`Answer for: ${question.prompt}`}
              onChange={(event) => onChange({ ...answer, text: event.target.value })}
            />
          ) : (
            <input
              autoFocus={autoFocus}
              className="input interaction-answer-input"
              type="text"
              value={answer.text ?? ""}
              placeholder="Type your answer…"
              title={`Answer for: ${question.prompt}`}
              onChange={(event) => onChange({ ...answer, text: event.target.value })}
            />
          )}
        </label>
      ) : null}
    </div>
  );
}

export function InteractionWorkbench({
  interaction,
  readOnly = false,
  onResolved,
  onCancelled,
  onMinimize,
  onClose,
  onAction,
  onDraftChange,
}: InteractionWorkbenchProps) {
  const pages = useMemo(() => pagesFor(interaction.questions), [interaction.questions]);
  const initialAnswers = readOnly
    ? answersById(interaction.answers)
    : answersById(interaction.draftAnswers);
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>(initialAnswers);
  const [pageIndex, setPageIndex] = useState(Math.min(interaction.currentPage ?? 0, pages.length - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const answersRef = useRef(answers);
  const pageRef = useRef(pageIndex);
  answersRef.current = answers;
  pageRef.current = pageIndex;

  useEffect(() => {
    setAnswers(readOnly ? answersById(interaction.answers) : answersById(interaction.draftAnswers));
    setPageIndex(Math.min(interaction.currentPage ?? 0, pages.length - 1));
    setError(null);
    setConfirmCancel(false);
  }, [interaction.id, interaction.answers, interaction.draftAnswers, interaction.currentPage, pages.length, readOnly]);

  const persistDraft = () => {
    if (readOnly || interaction.status !== "pending") return;
    void nativeInteractionSaveDraft(interaction.id, Object.values(answersRef.current), pageRef.current)
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        onAction?.("Questionnaire draft save failed", message);
        setError(message);
      });
  };

  useEffect(() => {
    if (readOnly || interaction.status !== "pending") return;
    const timer = window.setTimeout(persistDraft, 350);
    return () => window.clearTimeout(timer);
  }, [answers, pageIndex, interaction.id, interaction.status, readOnly]);

  useEffect(() => {
    if (readOnly || interaction.status !== "pending") return;
    const flush = () => persistDraft();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      persistDraft();
    };
  }, [interaction.id, interaction.status, readOnly]);

  useEffect(() => {
    if (!onMinimize || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onAction?.("Questionnaire minimized", `interaction=${interaction.id}; source=escape`);
      persistDraft();
      onMinimize();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMinimize, readOnly, interaction.id]);

  const page = pages[pageIndex] ?? pages[0];
  const updateAnswer = (question: Question, answer: QuestionAnswer) => {
    setAnswers((current) => {
      const next = { ...current, [question.id]: answer };
      onDraftChange?.(Object.values(next), pageRef.current);
      return next;
    });
    setError(null);
  };
  const validate = (questions: Question[]) => {
    const missing = questions.find((question) => question.required && !hasAnswer(question, answers[question.id]));
    if (missing) {
      setError(`Answer required: ${missing.prompt}`);
      onAction?.("Questionnaire navigation blocked", `interaction=${interaction.id}; missing=${missing.id}`);
      return false;
    }
    return true;
  };
  const goToPage = (next: number) => {
    if (next > pageIndex && !validate(page.questions)) return;
    const bounded = Math.max(0, Math.min(next, pages.length - 1));
    setPageIndex(bounded);
    onDraftChange?.(Object.values(answersRef.current), bounded);
    onAction?.("Questionnaire page changed", `interaction=${interaction.id}; page=${bounded}`);
  };
  const submit = async () => {
    if (!validate(interaction.questions)) return;
    onAction?.("Questionnaire submit requested", `interaction=${interaction.id}; answers=${Object.keys(answers).length}`);
    setBusy(true);
    setError(null);
    try {
      const resolved = await nativeInteractionResolve(interaction.id, Object.values(answers));
      onResolved?.(resolved);
      onAction?.("Questionnaire submitted", `interaction=${interaction.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      onAction?.("Questionnaire submit failed", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    onAction?.("Questionnaire cancel requested", `interaction=${interaction.id}`);
    setBusy(true);
    setError(null);
    try {
      await nativeInteractionCancel(interaction.id);
      onCancelled?.(interaction.id);
      onAction?.("Questionnaire cancelled", `interaction=${interaction.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      onAction?.("Questionnaire cancel failed", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const headerActions = (
    <>
      {onMinimize && !readOnly ? (
        <button className="btn-icon" type="button" title="Minimize questionnaire" onClick={() => { onAction?.("Questionnaire minimized", `interaction=${interaction.id}; source=button`); persistDraft(); onMinimize(); }}>
          <Minus size={16} />
        </button>
      ) : null}
      {onClose ? (
        <button className="btn-icon" type="button" title="Close questionnaire detail" onClick={onClose}>
          <X size={16} />
        </button>
      ) : null}
    </>
  );
  const footer = (
    <>
      <div className="interaction-page-actions">
        <button className="btn btn-sm" type="button" title="Previous questionnaire page" disabled={pageIndex === 0 || busy} onClick={() => goToPage(pageIndex - 1)}>
          <ChevronLeft size={14} /> Back
        </button>
        {pageIndex < pages.length - 1 ? (
          <button className="btn btn-sm btn-primary" type="button" title="Continue to the next questionnaire page" disabled={busy} onClick={() => goToPage(pageIndex + 1)}>
            Next <ChevronRight size={14} />
          </button>
        ) : !readOnly ? (
          <button className="btn btn-sm btn-primary" type="button" title="Submit answers and resume the agent" disabled={busy} onClick={() => void submit()}>
            <Check size={14} /> Submit answers
          </button>
        ) : null}
      </div>
      {!readOnly ? (
        confirmCancel ? (
          <div className="interaction-cancel-confirm" role="group" aria-label="Confirm questionnaire cancellation">
            <span>Cancel and tell the agent to stop waiting?</span>
            <button className="btn btn-sm" type="button" title="Keep answering the questionnaire" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep answering</button>
            <button className="btn btn-sm" type="button" title="Confirm questionnaire cancellation" disabled={busy} onClick={() => void cancel()}>Confirm cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm btn-ghost" type="button" title="Cancel this questionnaire" disabled={busy} onClick={() => setConfirmCancel(true)}>
            <X size={14} /> Cancel
          </button>
        )
      ) : null}
    </>
  );

  return (
    <WorkbenchShell
      ariaLabel={interaction.title ?? "Agent questionnaire"}
      eyebrow={<><HelpCircle size={14} /> {readOnly ? "Questionnaire history" : "Your input is needed"}</>}
      title={interaction.title ?? "Agent question"}
      description={interaction.description}
      headerActions={headerActions}
      progressLabel={`Page ${pageIndex + 1} of ${pages.length}`}
      progressTitle={page?.title}
      footer={footer}
      readOnly={readOnly}
    >
      {page?.description ? <p className="interaction-page-description">{page.description}</p> : null}

      <div className="interaction-question-list">
        {page?.questions.map((question, index) => {
          const answer = answers[question.id] ?? emptyAnswer(question);
          return (
            <div className="interaction-question" key={question.id}>
              <div className="interaction-question-heading">
                <span>{question.prompt}</span>
                {question.required ? <span className="interaction-required">Required</span> : null}
              </div>
              {question.detail ? <pre className="interaction-question-detail" title="Read-only context for this question">{question.detail}</pre> : null}
              <QuestionControls
                question={question}
                answer={answer}
                readOnly={readOnly}
                autoFocus={!readOnly && index === 0}
                onChange={(next) => updateAnswer(question, next)}
              />
            </div>
          );
        })}
      </div>

      {error ? <div className="question-card-error text-error" role="alert">{error}</div> : null}
    </WorkbenchShell>
  );
}
