import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import * as AssistantTools from "./assistant/tools.js";
import type { ToolClass } from "./tool.js";

export const AllTools: ToolClass<any, any, any>[] = [
    ...MongoDBTools,
    ...Object.values(AssistantTools),
    ...AtlasTools,
    ...AtlasLocalTools,
];

export { MongoDBToolBase, type IMongoDBConfig, type IMongoDBSession } from "@mongodb-js/mcp-tools-mongodb";

// Export all the individual tools for handpicking
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "@mongodb-js/mcp-tools-mongodb";
export * from "./assistant/tools.js";
// Re-export from atlas, but exclude AtlasClusterConnectionInfo since it's also in mongodb package
export { AtlasTools, AtlasToolBase, type IAtlasConfig, type IAtlasSession } from "@mongodb-js/mcp-tools-atlas";
// Export AtlasClusterConnectionInfo explicitly from mongodb package
export type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-tools-mongodb";

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
