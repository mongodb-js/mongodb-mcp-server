// CLI server class and types
export { CliServer } from "./cliServer.js";
export type { CliServerOptions, ToolRegistry, ResourceRegistry, McpSession } from "./cliServer.js";
export type { ServerMetadata } from "@mongodb-js/mcp-types";

// Main CLI exports
export { runMcpCli, type RunMcpCliOptions } from "./runMcpCli.js";
export { startServer } from "./startServer.js";

// Server creation helper
export { createServicesFromUserConfig, type CreateServicesOptions } from "./createServicesFromUserConfig.js";

export type { CliHandler, CliHandlerContext } from "./cliHandler.js";

export { CliSession } from "./cliSession.js";
export type { CliSessionOptions } from "./cliSession.js";

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

export {
    applyConfigOverrides,
    ConfigOverrideError,
    getConfigMeta,
    nameToConfigKey,
    CONFIG_HEADER_PREFIX,
    CONFIG_QUERY_PREFIX,
} from "./config/configOverrides.js";

// Transport constants
export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "./transports/constants.js";

// Dry run runner
export {
    DryRunModeRunner,
    type DryRunServer,
    type DryRunLogger,
    type DryRunModeRunnerOptions,
} from "./transports/dryModeRunner.js";

// CLI Handlers
export { DryRunHandler, type DryRunHandlerOptions } from "./handlers/dryRunHandler.js";
export { HelpHandler } from "./handlers/helpHandler.js";
export { VersionHandler } from "./handlers/versionHandler.js";

// MCP resources
export { Resources, ConfigResource, DebugResource, ExportedData } from "./resources/resources.js";
