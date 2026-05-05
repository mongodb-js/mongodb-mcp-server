export { AssistantToolBase, type IAssistantConfig } from "./assistantTool.js";
export * from "./tools/tools.js";

import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const AssistantTools: ToolClass[] = Object.values(tools);
