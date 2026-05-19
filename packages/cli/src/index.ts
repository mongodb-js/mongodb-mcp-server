// Main CLI run function and types
export {
    runMcpCli,
    createServerFromUserConfig,
    startServer,
    type CLIOptions,
    type Handler,
    type ClientInfo,
    type ConsoleLogger,
    type OnExit,
    type StartableServer,
} from "./cli.js";

// Server infrastructure type
export type { ServerInfrastructure, PackageInfo } from "./serverFactory.js";

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

// Transport constants
export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "./transports/constants.js";

// Dry run runner
export {
    DryRunModeRunner,
    type DryRunServer,
    type DryRunLogger,
    type DryRunModeRunnerOptions,
} from "./transports/dryModeRunner.js";

// Server wrapper
export { MCPHttpServerWrapper } from "./server/mcpHttpServerWrapper.js";
