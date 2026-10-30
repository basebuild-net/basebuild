import type { MessageKey } from "../en";
import { layoutZhCN } from "./layout";
import { layoutInspectorZhCN } from "./layout-inspector";
import { layoutSettingsZhCN } from "./layout-settings";
import { panelsZhCN } from "./panels";
import { panelsChatZhCN } from "./panels-chat";
import { planningZhCN } from "./planning";

export const zhCN = {
  ...layoutZhCN,
  ...layoutInspectorZhCN,
  ...layoutSettingsZhCN,
  ...panelsZhCN,
  ...panelsChatZhCN,
  ...planningZhCN,
} satisfies Record<MessageKey, string>;
