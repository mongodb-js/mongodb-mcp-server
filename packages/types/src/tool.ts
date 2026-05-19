import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export type { CallToolResult };

/**
 * The type of operation the tool performs. This is used when evaluating if a tool is allowed to run based on
 * the config's `disabledTools` and `readOnly` settings.
 * - `metadata` is used for tools that read but do not access potentially user-generated
 *   data, such as listing databases, collections, or indexes, or inferring collection schema.
 * - `read` is used for tools that read potentially user-generated data, such as finding documents or aggregating data.
 *   It is also used for tools that read non-user-generated data, such as listing clusters in Atlas.
 * - `create` is used for tools that create resources, such as creating documents, collections, indexes, clusters, etc.
 * - `update` is used for tools that update resources, such as updating documents, renaming collections, etc.
 * - `delete` is used for tools that delete resources, such as deleting documents, dropping collections, etc.
 * - `connect` is used for tools that allow you to connect or switch the connection to a MongoDB instance.
 */
export type OperationType = "metadata" | "read" | "create" | "delete" | "update" | "connect";

/**
 * The category of the tool. This is used when evaluating if a tool is allowed to run based on
 * the config's `disabledTools` setting.
 * - `mongodb` is used for tools that interact with a MongoDB instance, such as finding documents,
 *   aggregating data, listing databases/collections/indexes, creating indexes, etc.
 * - `atlas` is used for tools that interact with MongoDB Atlas, such as listing clusters, creating clusters, etc.
 * - `atlas-local` is used for tools that interact with local Atlas deployments.
 * - `assistant` is used for tools that interact with the Assistant, such as searching the public knowledge base.
 * - `custom` is used for tools that are not part of the default tool categories.
 */
export type ToolCategory = "mongodb" | "atlas" | "atlas-local" | "assistant" | "custom";

/**
 * Context provided during tool execution.
 */
export type ToolExecutionContext = {
    /** AbortSignal for cancellation support */
    signal: AbortSignal;
    /**
     * Request context object available only when running atop
     * StreamableHttpTransport.
     */
    requestInfo?: {
        headers?: Record<string, unknown>;
    };
};

export type ToolClass<TParams extends unknown[] = unknown[]> = {
    new (params: TParams): {
        name: string;
        category: ToolCategory;
        operationType: OperationType;
    };
    toolName: string;
    category: ToolCategory;
    operationType: OperationType;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolClass = ToolClass<any>;

export interface IToolRegistrar {
    register(tool: ToolClass): boolean;
}
