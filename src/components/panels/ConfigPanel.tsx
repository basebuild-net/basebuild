import { t } from "../../i18n";
export function ConfigPanel({ projectPath: _projectPath }: { projectPath: string | null }) {
  return (
    <div className="stack">
      <h3>{t("configPanel.configPacks")}</h3>
      <p className="text-muted text-sm">{t("configPanel.comingSoon")}</p>
      <p className="text-muted text-sm">
        {t("configPanel.shareBasebuildGuiSystemPrompt")}
      </p>
    </div>
  );
}
