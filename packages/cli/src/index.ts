// Main CLI setup function
export {
    setupMcpCli,
    type CLIOptions,
    type ServerFactory,
    type RequestHandler,
    handleHelpRequest,
    handleVersionRequest,
    createDefaultLoggers,
    handleDryRun,
} from "./cli.js";

// Config parsing and types
export { parseUserConfig, type ParserOptions, defaultParserOptions } from "./config/parseUserConfig.js";
export {
    UserConfigSchema,
    configRegistry,
    ALL_CONFIG_KEYS,
    type UserConfig,
} from "./config/userConfig.js";

// Config utilities
export {
    commaSeparatedToArray,
    parseBoolean,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
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
