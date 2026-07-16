export { AssistantToolBase, type IAssistantSession } from "./assistantTool.js";
export {
    SearchKnowledgeTool,
    SearchKnowledgeToolName,
    ListKnowledgeSourcesTool,
    ListKnowledgeSourcesToolName,
} from "./tools/tools.js";

import type { IAssistantSession } from "./assistantTool.js";
import { SearchKnowledgeTool, ListKnowledgeSourcesTool } from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";

export const AssistantTools: ToolClass<IAssistantSession>[] = [SearchKnowledgeTool, ListKnowledgeSourcesTool];
