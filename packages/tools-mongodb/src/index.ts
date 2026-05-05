// Export base class and types
export { MongoDBToolBase } from "./mongodbTool.js";
export type { IMongoDBConfig } from "./mongodbConfig.js";
export type { IMongoDBSession, ConnectionErrorOutcome } from "./mongodbSession.js";

// Export connection-related classes
export {
    ConnectionManager,
    MCPConnectionManager,
    ConnectionStateConnected,
    type ConnectionSettings,
    type AnyConnectionState,
    type ConnectionManagerEvents,
    type ConnectionStateConnecting,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type ConnectionManagerFactoryFn,
    defaultCreateConnectionManager,
    type IDeviceId,
    type IPackageInfo,
    type IUserConfig,
} from "./connection/connectionManager.js";

export {
    getConnectionStringInfo,
    type ConnectionStringInfo,
    type ConnectionStringAuthType,
    type ConnectionStringHostType,
    type AtlasClusterConnectionInfo,
    type OIDCConnectionAuthType,
} from "./connection/connectionInfo.js";

export {
    setAppNameParamIfMissing,
    validateConnectionString,
    type AppNameComponents,
} from "./connection/connectionOptions.js";

export { ErrorCodes, MongoDBError } from "./connection/errors.js";

// Export tools
export * from "./tools/tools.js";

// Export tools array
import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const MongoDBTools: ToolClass[] = Object.values(tools);
