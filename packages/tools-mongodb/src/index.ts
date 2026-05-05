export {
  MongoDBToolBase,
  type IMongoDBConfig,
  type IMongoDBSession,
  DBOperationArgs,
  CollOperationArgs,
} from "./mongodbTool.js";
export type {
  ConnectionSettings,
  ConnectionState,
  ConnectionStateConnected,
  ConnectionStateConnecting,
  ConnectionStateDisconnected,
  ConnectionStateErrored,
  AnyConnectionState,
  ConnectionManager,
  MCPConnectionManager,
  ConnectionManagerFactoryFn,
  defaultCreateConnectionManager,
} from "./common/connectionManager.js";
export type {
  ConnectionStringInfo,
  ConnectionStringAuthType,
  AtlasClusterConnectionInfo,
} from "./common/connectionInfo.js";
export { ErrorCodes, MongoDBError } from "./common/errors.js";
export * from "./tools/tools.js";

import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const MongoDBTools: ToolClass[] = Object.values(tools);
