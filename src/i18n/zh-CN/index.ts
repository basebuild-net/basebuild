import { layoutStringsZhCN } from "./layout-strings";
import { panelsStringsZhCN } from "./panels-strings";
import { chatStringsZhCN } from "./chat-strings";
import { commandsStringsZhCN } from "./commands-strings";
import { stateStringsZhCN } from "./state-strings";
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
  ...layoutStringsZhCN,
  ...panelsStringsZhCN,
  ...chatStringsZhCN,
  ...commandsStringsZhCN,
  ...stateStringsZhCN,
} satisfies Record<MessageKey, string>;
