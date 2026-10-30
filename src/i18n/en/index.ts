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
} as const;

export type MessageKey = keyof typeof en;
