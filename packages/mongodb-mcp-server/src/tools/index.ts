/**
 * Temporary file for comparing the API Extractor report only (`api-extractor/api-extractor-tools.json`).
 * Not published as a package export — import from `@mongodb-js/mcp-tools-*` or `mongodb-mcp-server`.
 */
export { MongoDBToolBase, type IMongoDBConfig, type IMongoDBSession } from "@mongodb-js/mcp-tools-mongodb";

export * from "@mongodb-js/mcp-tools-atlas-local";
export * from "@mongodb-js/mcp-tools-mongodb";
export * from "@mongodb-js/mcp-tools-assistant";
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
} from "@mongodb-js/mcp-core";
