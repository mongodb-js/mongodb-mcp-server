import type { IToolSession } from "@mongodb-js/mcp-types";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { ConnectionManager, AnyConnectionState, AtlasClusterConnectionInfo, ConnectionStringInfo } from "./connection/connectionManager.js";
import type { MongoDBError, ErrorCodes } from "./connection/errors.js";
import type { ToolCategory } from "@mongodb-js/mcp-types";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ConnectionErrorOutcome {
    errorHandled: boolean;
    result: CallToolResult;
}

export interface IMongoDBSession extends IToolSession {
    readonly connectionManager: ConnectionManager;
    readonly isConnectedToMongoDB: boolean;
    readonly serviceProvider: NodeDriverServiceProvider;
    readonly connectedAtlasCluster: AtlasClusterConnectionInfo | undefined;
    readonly connectionStringInfo: ConnectionStringInfo | undefined;
    connectToConfiguredConnection(): Promise<void>;
    isSearchSupported(): Promise<boolean>;
    assertSearchSupported(): Promise<void>;
    isToolCategoryAvailable(category: ToolCategory): boolean;
    availableTools: string[];
    connectionErrorHandler(
        error: MongoDBError<ErrorCodes.NotConnectedToMongoDB | ErrorCodes.MisconfiguredConnectionString>,
        context: { availableTools: string[]; connectionState: AnyConnectionState }
    ): Promise<ConnectionErrorOutcome>;
}
