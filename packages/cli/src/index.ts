// Server class and types
export { Server } from "./server.js";
export type { ServerOptions, ServerTelemetry, ServerLogger, ToolRegistry } from "./server.js";
export type { ServerMetadata } from "@mongodb-js/mcp-types";
// Main CLI exports
export { runMcpCli } from "./runMcpCli.js";
export { startServer } from "./startServer.js";
export { createServicesFromUserConfig } from "./createServices.js";

// Type exports
export type { ConsoleLogger, OnExit, Handler, StartableServer } from "./types.js";

export { Session } from "./session.js";

// Config parsing and types
export { parseUserConfig, type ParserOptions, defaultParserOptions } from "./config/parseUserConfig.js";
export { UserConfigSchema, configRegistry, ALL_CONFIG_KEYS, type UserConfig } from "./config/userConfig.js";

// Config utilities
export {
    commaSeparatedToArray,
    parseBoolean,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
    getLocalDataPath,
    getLogPath,
    getExportsPath,
    type CustomOverrideLogic,
    type OverrideBehavior,
    type ConfigFieldMeta,
} from "./config/configUtils.js";

export type { ServerSession } from "./server.js";

// Transport constants
export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "./transports/constants.js";

// Dry run runner
export {
    DryRunModeRunner,
    type DryRunServer,
    type DryRunLogger,
    type DryRunModeRunnerOptions,
} from "./transports/dryModeRunner.js";

// Dry run handler
export { DryRunHandler } from "./handlers/dryRunHandler.js";
