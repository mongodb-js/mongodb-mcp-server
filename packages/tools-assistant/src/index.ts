export {
    AssistantToolBase,
    type AssistantToolServices,
    type AssistantToolServer,
    type IAssistantConfig,
} from "./assistantTool.js";
export {
    SearchKnowledgeTool,
    SearchKnowledgeToolName,
    ListKnowledgeSourcesTool,
    ListKnowledgeSourcesToolName,
} from "./tools/tools.js";

import type { AssistantToolServer } from "./assistantTool.js";
import { SearchKnowledgeTool, ListKnowledgeSourcesTool } from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";

export const AssistantTools: ToolClass<AssistantToolServer>[] = [SearchKnowledgeTool, ListKnowledgeSourcesTool];
