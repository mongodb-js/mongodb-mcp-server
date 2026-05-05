import type { IToolSession, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type {
    ConnectionManager,
    AnyConnectionState,
    AtlasClusterConnectionInfo,
    ConnectionStringInfo,
    ConnectionSettings,
} from "./connection/connectionManager.js";
import type { MongoDBError } from "./connection/errors.js";
import type { ToolCategory } from "@mongodb-js/mcp-types";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ConnectionErrorOutcome {
    errorHandled: boolean;
    result: CallToolResult;
}

export interface ExportsManager {
    createJSONExport(params: {
        input: unknown;
        exportName: string;
        exportTitle: string;
        jsonExportFormat: "relaxed" | "canonical";
    }): Promise<{ exportURI: string; exportPath: string }>;
}

export interface IMongoDBSession extends IToolSession {
    readonly connectionManager: ConnectionManager;
    readonly exportsManager: ExportsManager;
    readonly isConnectedToMongoDB: boolean;
    readonly serviceProvider: NodeDriverServiceProvider;
    readonly connectedAtlasCluster: AtlasClusterConnectionInfo | undefined;
    readonly connectionStringInfo: ConnectionStringInfo | undefined;
    logger: ICompositeLogger;
    connectToConfiguredConnection(): Promise<void>;
    connectToMongoDB(settings: ConnectionSettings): Promise<void>;
    isSearchSupported(): Promise<boolean>;
    assertSearchSupported(): Promise<void>;
    isToolCategoryAvailable(category: ToolCategory): boolean;
    availableTools: string[];
    connectionErrorHandler(
        error: MongoDBError,
        context: { availableTools: string[]; connectionState: AnyConnectionState }
    ): Promise<ConnectionErrorOutcome>;
}
