import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { AssistantTools } from "@mongodb-js/mcp-tools-assistant";
import * as MongoDbTools from "./mongodb/tools.js";
import type { ToolClass } from "./tool.js";

// Export the collection of tools for easier reference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AllTools: ToolClass<any, any, any>[] = [
    ...Object.values(MongoDbTools),
    ...AtlasTools,
    ...AtlasLocalTools,
    ...AssistantTools,
];

export { MongoDBToolBase } from "./mongodb/mongodbTool.js";

// Export all the individual tools for handpicking
export * from "@mongodb-js/mcp-tools-atlas";
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "@mongodb-js/mcp-tools-assistant";
export * from "./mongodb/tools.js";

// Export the base tool class and supporting types.
export {
    ToolBase,
    type ToolClass,
    type ToolConstructorParams,
    type ToolCategory,
    type OperationType,
    type ToolArgs,
    type ToolExecutionContext,
    type ToolResult,
} from "./tool.js";
