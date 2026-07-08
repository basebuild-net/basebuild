import type { PromptMode } from "./promptDelivery";

/**
 * Planning action types — each maps to a destination-aware delivery path.
 * The router ensures every planning action goes through the destination
 * picker with `send` mode (not `insert`), so the user chooses where the
 * prompt lands and it fires exactly once.
 */
export type PlanningActionType =
  | "schematic-wizard"
  | "schematic-section"
  | "generate-categories"
  | "generate-ideas"
  | "generate-ideas-for-category";

export type PlanningAction = {
  type: PlanningActionType;
  /** The prompt text to deliver. */
  text: string;
  /** Delivery mode — always "send" for planning actions. */
  mode: PromptMode;
  /** Optional context for logging/diagnostics. */
  context?: string;
};

export type PlanningActionDestination =
  | { kind: "existing"; chatSessionId: string; panelId: string }
  | { kind: "new" };

/**
 * Build a planning action for the schematic wizard.
 */
export function schematicWizardAction(skillBody: string, section?: string): PlanningAction {
  const target = section
    ? `Focus on the "${section}" section only. Read what the repository already says about it, prefill what you can, then ask the user one focused question to confirm or fill the gap. Do not rewrite other sections.`
    : `Start in Create mode (or Update mode if a schematic already exists). Begin with the Blueprint questions — archetype, team size, stage — since they scope every later answer. Then work through the remaining sections in template order.`;
  const text = `${skillBody}

---

You are now running the Project Schematic skill for this project. ${target}

Rules:
- Read the repository first (manifests, README, AGENTS.md, directory structure, recent git history) and prefill observable facts for confirmation instead of asking the user to recite them.
- Use the \`ask_user\` tool for every question — it presents clickable option cards instead of prose. One question at a time; wait for the user's answer before moving on.
- Let the user finish whenever they want — they can say "done" to stop, or keep going to add more context.
- Never fabricate facts. If something is not observable, ask.
- Do not write the schematic file until the user explicitly approves. When ready, use \`ask_user\` with a confirm question to get approval, then write to .basebuild/project-schematic.md.
- Keep it concise — readable in under three minutes.`;
  return {
    type: section ? "schematic-section" : "schematic-wizard",
    text,
    mode: "send",
    context: section ? `schematic section: ${section}` : "schematic wizard",
  };
}

/**
 * Build a planning action for generating categories from the schematic.
 */
export function generateCategoriesAction(): PlanningAction {
  return {
    type: "generate-categories",
    text: "Read the project schematic at .basebuild/project-schematic.md and generate 3-5 categories that organize the project's goals into actionable areas. Use the `ask_user` tool to present each category as a clickable card with a name and description. Wait for the user to approve or modify each one before persisting.",
    mode: "send",
    context: "generate categories",
  };
}

/**
 * Build a planning action for generating ideas for a category (or all).
 */
export function generateIdeasAction(categoryName?: string, categoryDescription?: string): PlanningAction {
  const text = categoryName
    ? `Generate new ideas for the "${categoryName}" category. ${categoryDescription ?? ""}`.trim()
    : "Generate ideas for this project.";
  return {
    type: categoryName ? "generate-ideas-for-category" : "generate-ideas",
    text,
    mode: "send",
    context: categoryName ? `ideas for category: ${categoryName}` : "ideas for project",
  };
}
