import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import * as AssistantTools from "./assistant/tools.js";
import type { ToolClass } from "./tool.js";

export const AllTools: ToolClass<any, any, any>[] = [
    ...Object.values({ ...MongoDbTools, ...AssistantTools }),
    ...AtlasTools,
    ...AtlasLocalTools,
];

export { MongoDBToolBase, type IMongoDBConfig, type IMongoDBSession } from "@mongodb-js/mcp-tools-mongodb";

// Export all the individual tools for handpicking
export * from "@mongodb-js/mcp-tools-atlas";
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "@mongodb-js/mcp-tools-mongodb";
export * from "./assistant/tools.js";

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
