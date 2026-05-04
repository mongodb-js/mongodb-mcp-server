import * as AtlasTools from "./atlas/tools.js";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import * as MongoDbTools from "./mongodb/tools.js";
import * as AssistantTools from "./assistant/tools.js";
import type { ToolClass } from "./tool.js";

// Export the collection of tools for easier reference
export const AllTools: ToolClass<any, any>[] = [
    ...Object.values({ ...MongoDbTools, ...AtlasTools, ...AssistantTools }),
    ...AtlasLocalTools,
];

export { MongoDBToolBase } from "./mongodb/mongodbTool.js";

// Export all the individual tools for handpicking
export * from "./atlas/tools.js";
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "./mongodb/tools.js";
export * from "./assistant/tools.js";

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
