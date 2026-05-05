export { AssistantToolBase, type IAssistantConfig } from "./assistantTool.js";
export {
    SearchKnowledgeTool,
    SearchKnowledgeToolName,
    ListKnowledgeSourcesTool,
    ListKnowledgeSourcesToolName,
} from "./tools/tools.js";

import { SearchKnowledgeTool, ListKnowledgeSourcesTool } from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const AssistantTools: ToolClass[] = [SearchKnowledgeTool, ListKnowledgeSourcesTool];
