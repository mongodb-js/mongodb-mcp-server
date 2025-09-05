import path from "path";
import os from "os";
import argv from "yargs-parser";
import type { CliOptions, ConnectionInfo } from "@mongosh/arg-parser";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { Keychain } from "./keychain.js";
import type { Secret } from "./keychain.js";
import levenshtein from "ts-levenshtein";

// From: https://github.com/mongodb-js/mongosh/blob/main/packages/cli-repl/src/arg-parser.ts
const OPTIONS = {
    string: [
        "apiBaseUrl",
        "apiClientId",
        "apiClientSecret",
        "connectionString",
        "httpHost",
        "httpPort",
        "idleTimeoutMs",
        "logPath",
        "notificationTimeoutMs",
        "telemetry",
        "transport",
        "apiVersion",
        "authenticationDatabase",
        "authenticationMechanism",
        "browser",
        "db",
        "gssapiHostName",
        "gssapiServiceName",
        "host",
        "oidcFlows",
        "oidcRedirectUri",
        "password",
        "port",
        "sslCAFile",
        "sslCRLFile",
        "sslCertificateSelector",
        "sslDisabledProtocols",
        "sslPEMKeyFile",
        "sslPEMKeyPassword",
        "sspiHostnameCanonicalization",
        "sspiRealmOverride",
        "tlsCAFile",
        "tlsCRLFile",
        "tlsCertificateKeyFile",
        "tlsCertificateKeyFilePassword",
        "tlsCertificateSelector",
        "tlsDisabledProtocols",
        "username",
    ],
    boolean: [
        "apiDeprecationErrors",
        "apiStrict",
        "help",
        "indexCheck",
        "ipv6",
        "nodb",
        "oidcIdTokenAsAccessToken",
        "oidcNoNonce",
        "oidcTrustedEndpoint",
        "readOnly",
        "retryWrites",
        "ssl",
        "sslAllowInvalidCertificates",
        "sslAllowInvalidHostnames",
        "sslFIPSMode",
        "tls",
        "tlsAllowInvalidCertificates",
        "tlsAllowInvalidHostnames",
        "tlsFIPSMode",
        "version",
    ],
    array: ["disabledTools", "loggers"],
    alias: {
        h: "help",
        p: "password",
        u: "username",
        "build-info": "buildInfo",
        browser: "browser",
        oidcDumpTokens: "oidcDumpTokens",
        oidcRedirectUrl: "oidcRedirectUri",
        oidcIDTokenAsAccessToken: "oidcIdTokenAsAccessToken",
    },
    configuration: {
        "camel-case-expansion": false,
        "unknown-options-as-args": true,
        "parse-positional-numbers": false,
        "parse-numbers": false,
        "greedy-arrays": true,
        "short-option-groups": false,
    },
} as const;

const ALL_CONFIG_KEYS = new Set(
    (OPTIONS.string as readonly string[])
        .concat(OPTIONS.array)
        .concat(OPTIONS.boolean)
        .concat(Object.keys(OPTIONS.alias))
);

export function validateConfigKey(key: string): { valid: boolean; suggestion?: string } {
    if (ALL_CONFIG_KEYS.has(key)) {
        return { valid: true };
    }

    let minLev = Number.MAX_VALUE;
    let suggestion = "";

    // find the closest match for a suggestion
    for (const validKey of ALL_CONFIG_KEYS) {
        // check if there is an exact case-insensitive match
        if (validKey.toLowerCase() === key.toLowerCase()) {
            return { valid: false, suggestion: validKey };
        }

        // else, infer something using levenshtein so we suggest a valid key
        const lev = levenshtein.get(key, validKey);
        if (lev < minLev) {
            minLev = lev;
            suggestion = validKey;
        }
    }

    if (minLev <= 2) {
        // accept up to 2 typos
        return { valid: false, suggestion };
    }

    return { valid: false };
}

function isConnectionSpecifier(arg: string | undefined): boolean {
    return (
        arg !== undefined &&
        (arg.startsWith("mongodb://") ||
            arg.startsWith("mongodb+srv://") ||
            !(arg.endsWith(".js") || arg.endsWith(".mongodb")))
    );
}

// If we decide to support non-string config options, we'll need to extend the mechanism for parsing
// env variables.
export interface UserConfig extends CliOptions {
    apiBaseUrl: string;
    apiClientId?: string;
    apiClientSecret?: string;
    telemetry: "enabled" | "disabled";
    logPath: string;
    exportsPath: string;
    exportTimeoutMs: number;
    exportCleanupIntervalMs: number;
    connectionString?: string;
    disabledTools: Array<string>;
    readOnly?: boolean;
    indexCheck?: boolean;
    transport: "stdio" | "http";
    httpPort: number;
    httpHost: string;
    httpHeaders: Record<string, string>;
    loggers: Array<"stderr" | "disk" | "mcp">;
    idleTimeoutMs: number;
    notificationTimeoutMs: number;
}

export const defaultUserConfig: UserConfig = {
    apiBaseUrl: "https://cloud.mongodb.com/",
    logPath: getLogPath(),
    exportsPath: getExportsPath(),
    exportTimeoutMs: 300000, // 5 minutes
    exportCleanupIntervalMs: 120000, // 2 minutes
    disabledTools: [],
    telemetry: "enabled",
    readOnly: false,
    indexCheck: false,
    transport: "stdio",
    httpPort: 3000,
    httpHost: "127.0.0.1",
    loggers: ["disk", "mcp"],
    idleTimeoutMs: 600000, // 10 minutes
    notificationTimeoutMs: 540000, // 9 minutes
    httpHeaders: {},
};

export const config = setupUserConfig({
    defaults: defaultUserConfig,
    cli: process.argv,
    env: process.env,
});

function getLocalDataPath(): string {
    return process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), "mongodb")
        : path.join(os.homedir(), ".mongodb");
}

export type DriverOptions = ConnectionInfo["driverOptions"];
export const defaultDriverOptions: DriverOptions = {
    readConcern: {
        level: "local",
    },
    readPreference: "secondaryPreferred",
    writeConcern: {
        w: "majority",
    },
    timeoutMS: 30_000,
    proxy: { useEnvironmentVariableProxies: true },
    applyProxyToOIDC: true,
};

export const driverOptions = setupDriverConfig({
    config,
    defaults: defaultDriverOptions,
});

function getLogPath(): string {
    const logPath = path.join(getLocalDataPath(), "mongodb-mcp", ".app-logs");
    return logPath;
}

function getExportsPath(): string {
    return path.join(getLocalDataPath(), "mongodb-mcp", "exports");
}

// Gets the config supplied by the user as environment variables. The variable names
// are prefixed with `MDB_MCP_` and the keys match the UserConfig keys, but are converted
// to SNAKE_UPPER_CASE.
function parseEnvConfig(env: Record<string, unknown>): Partial<UserConfig> {
    const CONFIG_WITH_URLS: Set<string> = new Set<(typeof OPTIONS)["string"][number]>(["connectionString"]);

    function setValue(obj: Record<string, unknown>, path: string[], value: string): void {
        const currentField = path.shift();
        if (!currentField) {
            return;
        }
        if (path.length === 0) {
            if (CONFIG_WITH_URLS.has(currentField)) {
                obj[currentField] = value;
                return;
            }

            const numberValue = Number(value);
            if (!isNaN(numberValue)) {
                obj[currentField] = numberValue;
                return;
            }

            const booleanValue = value.toLocaleLowerCase();
            if (booleanValue === "true" || booleanValue === "false") {
                obj[currentField] = booleanValue === "true";
                return;
            }

            // Try to parse an array of values
            if (value.indexOf(",") !== -1) {
                obj[currentField] = value.split(",").map((v) => v.trim());
                return;
            }

            obj[currentField] = value;
            return;
        }

        if (!obj[currentField]) {
            obj[currentField] = {};
        }

        setValue(obj[currentField] as Record<string, unknown>, path, value);
    }

    const result: Record<string, unknown> = {};
    const mcpVariables = Object.entries(env).filter(
        ([key, value]) => value !== undefined && key.startsWith("MDB_MCP_")
    ) as [string, string][];
    for (const [key, value] of mcpVariables) {
        const fieldPath = key
            .replace("MDB_MCP_", "")
            .split(".")
            .map((part) => SNAKE_CASE_toCamelCase(part));

        setValue(result, fieldPath, value);
    }

    return result;
}

function SNAKE_CASE_toCamelCase(str: string): string {
    return str.toLowerCase().replace(/([-_][a-z])/g, (group) => group.toUpperCase().replace("_", ""));
}

// Right now we have arguments that are not compatible with the format used in mongosh.
// An example is using --connectionString and positional arguments.
// We will consolidate them in a way where the mongosh format takes precedence.
// We will warn users that previous configuration is deprecated in favour of
// whatever is in mongosh.
function parseCliConfig(args: string[]): CliOptions {
    const programArgs = args.slice(2);
    const parsed = argv(programArgs, OPTIONS as unknown as argv.Options) as unknown as CliOptions &
        UserConfig & {
            _?: string[];
        };

    const positionalArguments = parsed._ ?? [];

    // we use console.warn here because we still don't have our logging system configured
    // so we don't have a logger. For stdio, the warning will be received as a string in
    // the client and IDEs like VSCode do show the message in the log window. For HTTP,
    // it will be in the stdout of the process.
    warnAboutDeprecatedOrUnknownCliArgs(
        { ...parsed, _: positionalArguments },
        {
            warn: (msg) => console.warn(msg),
            exit: (status) => process.exit(status),
        }
    );

    // if we have a positional argument that matches a connection string
    // store it as the connection specifier and remove it from the argument
    // list, so it doesn't get misunderstood by the mongosh args-parser
    if (!parsed.nodb && isConnectionSpecifier(positionalArguments[0])) {
        parsed.connectionSpecifier = positionalArguments.shift();
    }

    delete parsed._;
    return parsed;
}

export function warnAboutDeprecatedOrUnknownCliArgs(
    args: Record<string, unknown>,
    { warn, exit }: { warn: (msg: string) => void; exit: (status: number) => void | never }
): void {
    let usedDeprecatedArgument = false;
    let usedInvalidArgument = false;

    const knownArgs = args as unknown as UserConfig & CliOptions;
    // the first position argument should be used
    // instead of --connectionString, as it's how the mongosh works.
    if (knownArgs.connectionString) {
        usedDeprecatedArgument = true;
        warn(
            "The --connectionString argument is deprecated. Prefer using the first positional argument for the connection string or the MDB_MCP_CONNECTION_STRING environment variable."
        );
    }

    for (const providedKey of Object.keys(args)) {
        if (providedKey === "_") {
            // positional argument
            continue;
        }

        const { valid, suggestion } = validateConfigKey(providedKey);
        if (!valid) {
            usedInvalidArgument = true;
            if (suggestion) {
                warn(`Invalid command line argument '${providedKey}'. Did you mean '${suggestion}'?`);
            } else {
                warn(`Invalid command line argument '${providedKey}'.`);
            }
        }
    }

    if (usedInvalidArgument || usedDeprecatedArgument) {
        warn("Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.");
    }

    if (usedInvalidArgument) {
        exit(1);
    }
}

function commaSeparatedToArray<T extends string[]>(str: string | string[] | undefined): T {
    if (str === undefined) {
        return [] as unknown as T;
    }

    if (!Array.isArray(str)) {
        return [str] as T;
    }

    if (str.length === 0) {
        return str as T;
    }

    if (str.length === 1) {
        return str[0]
            ?.split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0) as T;
    }

    return str as T;
}

export function registerKnownSecretsInRootKeychain(userConfig: Partial<UserConfig>): void {
    const keychain = Keychain.root;

    const maybeRegister = (value: string | undefined, kind: Secret["kind"]): void => {
        if (value) {
            keychain.register(value, kind);
        }
    };

    maybeRegister(userConfig.apiClientId, "user");
    maybeRegister(userConfig.apiClientSecret, "password");
    maybeRegister(userConfig.awsAccessKeyId, "password");
    maybeRegister(userConfig.awsIamSessionToken, "password");
    maybeRegister(userConfig.awsSecretAccessKey, "password");
    maybeRegister(userConfig.awsSessionToken, "password");
    maybeRegister(userConfig.password, "password");
    maybeRegister(userConfig.tlsCAFile, "url");
    maybeRegister(userConfig.tlsCRLFile, "url");
    maybeRegister(userConfig.tlsCertificateKeyFile, "url");
    maybeRegister(userConfig.tlsCertificateKeyFilePassword, "password");
    maybeRegister(userConfig.username, "user");
}

export function setupUserConfig({
    cli,
    env,
    defaults,
}: {
    cli: string[];
    env: Record<string, unknown>;
    defaults: Partial<UserConfig>;
}): UserConfig {
    const userConfig: UserConfig = {
        ...defaults,
        ...parseEnvConfig(env),
        ...parseCliConfig(cli),
    } as UserConfig;

    userConfig.disabledTools = commaSeparatedToArray(userConfig.disabledTools);
    userConfig.loggers = commaSeparatedToArray(userConfig.loggers);

    if (userConfig.connectionString && userConfig.connectionSpecifier) {
        const connectionInfo = generateConnectionInfoFromCliArgs(userConfig);
        userConfig.connectionString = connectionInfo.connectionString;
    }

    const transport = userConfig.transport as string;
    if (transport !== "http" && transport !== "stdio") {
        throw new Error(`Invalid transport: ${transport}`);
    }

    const telemetry = userConfig.telemetry as string;
    if (telemetry !== "enabled" && telemetry !== "disabled") {
        throw new Error(`Invalid telemetry: ${telemetry}`);
    }

    const httpPort = +userConfig.httpPort;
    if (httpPort < 1 || httpPort > 65535 || isNaN(httpPort)) {
        throw new Error(`Invalid httpPort: ${userConfig.httpPort}`);
    }

    if (userConfig.loggers.length === 0) {
        throw new Error("No loggers found in config");
    }

    const loggerTypes = new Set(userConfig.loggers);
    if (loggerTypes.size !== userConfig.loggers.length) {
        throw new Error("Duplicate loggers found in config");
    }

    for (const loggerType of userConfig.loggers as string[]) {
        if (loggerType !== "mcp" && loggerType !== "disk" && loggerType !== "stderr") {
            throw new Error(`Invalid logger: ${loggerType}`);
        }
    }

    registerKnownSecretsInRootKeychain(userConfig);
    return userConfig;
}

export function setupDriverConfig({
    config,
    defaults,
}: {
    config: UserConfig;
    defaults: Partial<DriverOptions>;
}): DriverOptions {
    const { driverOptions } = generateConnectionInfoFromCliArgs(config);
    return {
        ...defaults,
        ...driverOptions,
    };
}
