import { layoutStringsEn } from "./layout-strings";
import { panelsStringsEn } from "./panels-strings";
import { chatStringsEn } from "./chat-strings";
import { commandsStringsEn } from "./commands-strings";
import { stateStringsEn } from "./state-strings";
import { layoutEn } from "./layout";
import { layoutInspectorEn } from "./layout-inspector";
import { layoutSettingsEn } from "./layout-settings";
import { panelsEn } from "./panels";
import { panelsChatEn } from "./panels-chat";
import { planningEn } from "./planning";

export const en = {
  ...layoutEn,
  ...layoutInspectorEn,
  ...layoutSettingsEn,
  ...panelsEn,
  ...panelsChatEn,
  ...planningEn,
  ...layoutStringsEn,
  ...panelsStringsEn,
  ...chatStringsEn,
  ...commandsStringsEn,
  ...stateStringsEn,
} as const;

export type MessageKey = keyof typeof en;
