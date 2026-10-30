import type { RuntimeDefaults, RuntimeProfile, ProfileValidation } from "../../lib/settings";
import { t } from "../../i18n";

type RuntimeDefaultsFieldsProps = {
  defaults: RuntimeDefaults;
  chatProfiles: RuntimeProfile[];
  terminalProfiles: RuntimeProfile[];
  profileValidations?: Record<string, ProfileValidation>;
  onChange: (d: RuntimeDefaults) => void;
};

export function RuntimeDefaultsFields({
  defaults,
  chatProfiles,
  terminalProfiles,
  profileValidations = {},
  onChange,
}: RuntimeDefaultsFieldsProps) {
  return (
    <>
      <label className="stack-sm">
        <span className="text-sm text-muted">{t("runtimeDefaultsFields.defaultChatAdapter")}</span>
        <select
          className="input"
          title={t("runtimeDefaultsFields.selectDefaultChatAdapter")}
          value={defaults.defaultChatProfileId ?? ""}
          onChange={(e) => onChange({ ...defaults, defaultChatProfileId: e.target.value || null })}
        >
          {chatProfiles.map((p) => {
            const v = profileValidations[p.id];
            return (
              <option key={p.id} value={p.id}>
                {p.label}{v && !v.valid ? t("runtimeDefaultsFields.unavailable") : ""}
              </option>
            );
          })}
        </select>
      </label>

      <label className="stack-sm">
        <span className="text-sm text-muted">{t("runtimeDefaultsFields.defaultTerminal")}</span>
        <select
          className="input"
          title={t("runtimeDefaultsFields.selectDefaultTerminal")}
          value={defaults.defaultTerminalProfileId ?? ""}
          onChange={(e) => onChange({ ...defaults, defaultTerminalProfileId: e.target.value || null })}
        >
          {terminalProfiles.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
    </>
  );
}
