import { useState } from "react";
import { ChevronRight, HelpCircle } from "lucide-react";
import type { PendingInteraction } from "../../lib/interactions";
import { formatInteractionAnswer, InteractionWorkbench } from "./InteractionWorkbench";

type QuestionCardProps = {
  interaction: PendingInteraction;
  onResolved?: (interaction: PendingInteraction) => void;
  onCancelled?: (interactionId: string) => void;
};

/// Transcript representation for ask_user interactions. Pending interactions
/// use the focused workbench; resolved interactions default to a compact,
/// reopenable preview and never expose mutable controls.
export function QuestionCard({ interaction, onResolved, onCancelled }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (interaction.status === "pending") {
    return (
      <InteractionWorkbench
        interaction={interaction}
        onResolved={onResolved}
        onCancelled={onCancelled}
      />
    );
  }

  if (expanded) {
    return (
      <InteractionWorkbench
        interaction={interaction}
        readOnly
        onClose={() => setExpanded(false)}
      />
    );
  }

  const answered = interaction.status === "answered";
  const title = interaction.title ?? interaction.questions[0]?.prompt ?? "Agent questionnaire";
  const firstAnswer = interaction.questions[0]
    ? formatInteractionAnswer(interaction.questions[0], interaction.answers)
    : "—";
  return (
    <button
      className={`chat-question-preview question-card question-card-${answered ? "success" : "muted"}`}
      type="button"
      title={`Reopen ${answered ? "answered" : "cancelled"} questionnaire`}
      onClick={() => setExpanded(true)}
    >
      <HelpCircle size={14} className="chat-question-preview-icon" />
      <span className="chat-question-preview-text">
        <strong>{title}</strong>
        <span>{answered ? firstAnswer : "Cancelled"}</span>
      </span>
      <span className="chat-question-preview-action">
        {answered ? "Answered" : "Cancelled"} <ChevronRight size={13} />
      </span>
    </button>
  );
}
