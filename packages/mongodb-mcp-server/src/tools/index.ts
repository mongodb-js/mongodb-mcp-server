import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { AssistantTools } from "@mongodb-js/mcp-tools-assistant";
import type { ToolClass } from "@mongodb-js/mcp-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AllTools: ToolClass<any>[] = [
    ...MongoDBTools,
    ...AtlasTools,
    ...AtlasLocalTools,
    ...AssistantTools,
] as const;

export { MongoDBToolBase, type IMongoDBConfig, type IMongoDBSession } from "@mongodb-js/mcp-tools-mongodb";

// Export all the individual tools for handpicking
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "@mongodb-js/mcp-tools-mongodb";
export * from "@mongodb-js/mcp-tools-assistant";
// Named atlas exports (avoid star-export duplication with mongodb tools package).
export { AtlasTools, AtlasToolBase, type IAtlasConfig, type IAtlasSession } from "@mongodb-js/mcp-tools-atlas";

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
