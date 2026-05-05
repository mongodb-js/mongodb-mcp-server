import * as AtlasTools from "./atlas/tools.js";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import * as AssistantTools from "./assistant/tools.js";
import type { ToolClass } from "./tool.js";

export const AllTools: ToolClass<any, any, any>[] = [
  ...Object.values({ ...AtlasTools, ...AssistantTools }),
  ...AtlasLocalTools,
  ...MongoDBTools,
];

export { MongoDBToolBase, type IMongoDBConfig, type IMongoDBSession } from "@mongodb-js/mcp-tools-mongodb";

export * from "./atlas/tools.js";
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
