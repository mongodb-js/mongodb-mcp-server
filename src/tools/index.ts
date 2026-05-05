import * as AtlasTools from "./atlas/tools.js";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import * as AssistantTools from "./assistant/tools.js";
import type { ToolClass } from "./tool.js";

// Export the collection of tools for easier reference
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AllTools: ToolClass<any, any, any>[] = [
    ...Object.values({ ...AtlasTools, ...AssistantTools }),
    ...AtlasLocalTools,
    ...MongoDBTools,
];

// Re-export MongoDB types from the new package
export {
    MongoDBToolBase,
    type IMongoDBConfig,
    type IMongoDBSession,
    ConnectionManager,
    MCPConnectionManager,
    type ConnectionSettings,
    type AnyConnectionState,
    type ConnectionManagerEvents,
    type ConnectionManagerFactoryFn,
    defaultCreateConnectionManager,
    type ConnectionStringInfo,
    type AtlasClusterConnectionInfo,
    setAppNameParamIfMissing,
    type AppNameComponents,
    ErrorCodes,
    MongoDBError,
} from "@mongodb-js/mcp-tools-mongodb";

// Export all the individual tools for handpicking
export * from "./atlas/tools.js";
export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "./assistant/tools.js";

// Export all MongoDB tools from the new package
export * from "@mongodb-js/mcp-tools-mongodb";

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
