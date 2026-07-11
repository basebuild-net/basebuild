import type { RuntimeDefaults, RuntimeProfile, ProfileValidation } from "../../lib/settings";

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
        <span className="text-sm text-muted">Default chat adapter</span>
        <select
          className="input"
          title="Select default chat adapter"
          value={defaults.defaultChatProfileId ?? ""}
          onChange={(e) => onChange({ ...defaults, defaultChatProfileId: e.target.value || null })}
        >
          {chatProfiles.map((p) => {
            const v = profileValidations[p.id];
            return (
              <option key={p.id} value={p.id}>
                {p.label}{v && !v.valid ? " (unavailable)" : ""}
              </option>
            );
          })}
        </select>
      </label>

      <label className="stack-sm">
        <span className="text-sm text-muted">Default terminal</span>
        <select
          className="input"
          title="Select default terminal"
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
