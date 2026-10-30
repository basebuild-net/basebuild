import { t } from "../../i18n";
export function RightPanel() {
  return (
    <aside className="right-panel" aria-label={t("rightPanel.taskAndRunStatus")}>
      <h2>{t("rightPanel.tasks")}</h2>
      <p>{t("rightPanel.projectTasksAndOmpTodo")}</p>
    </aside>
  );
}
