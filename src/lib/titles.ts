/** Human-readable chat/panel titles.
 *
 *  Sessions auto-titled from a first message that was a command invocation
 *  (e.g. `<command name="/skill:basebuild-sync">…</command>`) carry raw
 *  markup in their stored title. The backend humanizes new titles; this
 *  mirrors that for titles already persisted in the database.
 */
export function humanizeChatTitle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("<command")) {
    const nameStart = trimmed.indexOf('name="');
    if (nameStart >= 0) {
      const valueStart = nameStart + 'name="'.length;
      const valueEnd = trimmed.indexOf('"', valueStart);
      if (valueEnd > valueStart) {
        const command = trimmed.slice(valueStart, valueEnd).replace(/^\//, "");
        if (command.startsWith("skill:")) return `Skill: ${command.slice("skill:".length)}`;
        if (command.length > 0) return command;
      }
    }
  }
  // Strip any residual tag spans and collapse whitespace.
  const stripped = trimmed.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > 0 ? stripped : trimmed;
}
