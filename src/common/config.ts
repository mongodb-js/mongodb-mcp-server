import argv from "yargs-parser";
import type { CliOptions, ConnectionInfo } from "@mongosh/arg-parser";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { Keychain } from "./keychain.js";
import type { Secret } from "./keychain.js";
import { z as z4 } from "zod/v4";
import {
    commaSeparatedToArray,
    type ConfigFieldMeta,
    getExportsPath,
    getLogPath,
    isConnectionSpecifier,
    validateConfigKey,
} from "./configUtils.js";
import { OPTIONS } from "./argsParserOptions.js";
import { similarityValues, previewFeatureValues } from "./schemas.js";

export const configRegistry = z4.registry<ConfigFieldMeta>();

export const UserConfigSchema = z4.object({
    apiBaseUrl: z4.string().default("https://cloud.mongodb.com/"),
    apiClientId: z4
        .string()
        .optional()
        .describe("Atlas API client ID for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true }),
    apiClientSecret: z4
        .string()
        .optional()
        .describe("Atlas API client secret for authentication. Required for running Atlas tools.")
        .register(configRegistry, { isSecret: true }),
    connectionString: z4
        .string()
        .optional()
        .describe(
            "MongoDB connection string for direct database connections. Optional, if not set, you'll need to call the connect tool before interacting with MongoDB data."
        )
        .register(configRegistry, { isSecret: true }),
    loggers: z4
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z4.array(z4.enum(["stderr", "disk", "mcp"]))
        )
        .check(
            z4.minLength(1, "Cannot be an empty array"),
            z4.refine((val) => new Set(val).size === val.length, {
                message: "Duplicate loggers found in config",
            })
        )
        .default(["disk", "mcp"])
        .describe("An array of logger types.")
        .register(configRegistry, {
            defaultValueDescription: '`"disk,mcp"` see below*',
        }),
    logPath: z4
        .string()
        .default(getLogPath())
        .describe("Folder to store logs.")
        .register(configRegistry, { defaultValueDescription: "see below*" }),
    disabledTools: z4
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z4.array(z4.string()))
        .default([])
        .describe("An array of tool names, operation types, and/or categories of tools that will be disabled."),
    confirmationRequiredTools: z4
        .preprocess((val: string | string[] | undefined) => commaSeparatedToArray(val), z4.array(z4.string()))
        .default([
            "atlas-create-access-list",
            "atlas-create-db-user",
            "drop-database",
            "drop-collection",
            "delete-many",
            "drop-index",
        ])
        .describe(
            "An array of tool names that require user confirmation before execution. Requires the client to support elicitation."
        ),
    readOnly: z4
        .boolean()
        .default(false)
        .describe(
            "When set to true, only allows read, connect, and metadata operation types, disabling create/update/delete operations."
        ),
    indexCheck: z4
        .boolean()
        .default(false)
        .describe(
            "When set to true, enforces that query operations must use an index, rejecting queries that perform a collection scan."
        ),
    telemetry: z4
        .enum(["enabled", "disabled"])
        .default("enabled")
        .describe("When set to disabled, disables telemetry collection."),
    transport: z4.enum(["stdio", "http"]).default("stdio").describe("Either 'stdio' or 'http'."),
    httpPort: z4.coerce
        .number()
        .int()
        .min(1, "Invalid httpPort: must be at least 1")
        .max(65535, "Invalid httpPort: must be at most 65535")
        .default(3000)
        .describe("Port number for the HTTP server (only used when transport is 'http')."),
    httpHost: z4
        .string()
        .default("127.0.0.1")
        .describe("Host address to bind the HTTP server to (only used when transport is 'http')."),
    httpHeaders: z4
        .object({})
        .passthrough()
        .default({})
        .describe(
            "Header that the HTTP server will validate when making requests (only used when transport is 'http')."
        ),
    idleTimeoutMs: z4.coerce
        .number()
        .default(600_000)
        .describe("Idle timeout for a client to disconnect (only applies to http transport)."),
    notificationTimeoutMs: z4.coerce
        .number()
        .default(540_000)
        .describe("Notification timeout for a client to be aware of disconnect (only applies to http transport)."),
    maxBytesPerQuery: z4.coerce
        .number()
        .default(16_777_216)
        .describe(
            "The maximum size in bytes for results from a find or aggregate tool call. This serves as an upper bound for the responseBytesLimit parameter in those tools."
        ),
    maxDocumentsPerQuery: z4.coerce
        .number()
        .default(100)
        .describe(
            "The maximum number of documents that can be returned by a find or aggregate tool call. For the find tool, the effective limit will be the smaller of this value and the tool's limit parameter."
        ),
    exportsPath: z4
        .string()
        .default(getExportsPath())
        .describe("Folder to store exported data files.")
        .register(configRegistry, { defaultValueDescription: "see below*" }),
    exportTimeoutMs: z4.coerce
        .number()
        .default(300_000)
        .describe("Time in milliseconds after which an export is considered expired and eligible for cleanup."),
    exportCleanupIntervalMs: z4.coerce
        .number()
        .default(120_000)
        .describe("Time in milliseconds between export cleanup cycles that remove expired export files."),
    atlasTemporaryDatabaseUserLifetimeMs: z4.coerce
        .number()
        .default(14_400_000)
        .describe(
            "Time in milliseconds that temporary database users created when connecting to MongoDB Atlas clusters will remain active before being automatically deleted."
        ),
    voyageApiKey: z4
        .string()
        .default("")
        .describe(
            "API key for Voyage AI embeddings service (required for vector search operations with text-to-embedding conversion)."
        )
        .register(configRegistry, { isSecret: true }),
    disableEmbeddingsValidation: z4
        .boolean()
        .default(false)
        .describe("When set to true, disables validation of embeddings dimensions."),
    vectorSearchDimensions: z4.coerce
        .number()
        .default(1024)
        .describe("Default number of dimensions for vector search embeddings."),
    vectorSearchSimilarityFunction: z4
        .enum(similarityValues)
        .default("euclidean")
        .describe("Default similarity function for vector search: 'euclidean', 'cosine', or 'dotProduct'."),
    previewFeatures: z4
        .preprocess(
            (val: string | string[] | undefined) => commaSeparatedToArray(val),
            z4.array(z4.enum(previewFeatureValues))
        )
        .default([])
        .describe("An array of preview features that are enabled."),
});

export type UserConfig = z4.infer<typeof UserConfigSchema> & CliOptions;

export const config = setupUserConfig({
    cli: process.argv,
    env: process.env,
});

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

// Gets the config supplied by the user as environment variables. The variable names
// are prefixed with `MDB_MCP_` and the keys match the UserConfig keys, but are converted
// to SNAKE_UPPER_CASE.
function parseEnvConfig(env: Record<string, unknown>): Partial<UserConfig> {
    const CONFIG_WITH_URLS: Set<string> = new Set<(typeof OPTIONS)["string"][number]>(["connectionString"]);

    function setValue(
        obj: Record<string, string | string[] | boolean | number | Record<string, unknown> | undefined>,
        path: string[],
        value: string
    ): void {
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

        setValue(obj[currentField] as Record<string, string | string[] | boolean | number | undefined>, path, value);
    }

    const result: Record<string, string | string[] | boolean | number | undefined> = {};
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
function parseCliConfig(args: string[]): Partial<Record<keyof CliOptions, string | number | undefined>> {
    const programArgs = args.slice(2);
    const parsed = argv(programArgs, OPTIONS as unknown as argv.Options) as unknown as Record<
        keyof CliOptions,
        string | number | undefined
    > & {
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
            "The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string."
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

export function setupUserConfig({ cli, env }: { cli: string[]; env: Record<string, unknown> }): UserConfig {
    const rawConfig = {
        ...parseEnvConfig(env),
        ...parseCliConfig(cli),
    };

    if (rawConfig.connectionString && rawConfig.connectionSpecifier) {
        const connectionInfo = generateConnectionInfoFromCliArgs(rawConfig as UserConfig);
        rawConfig.connectionString = connectionInfo.connectionString;
    }

    const parseResult = UserConfigSchema.safeParse(rawConfig);
    if (parseResult.error) {
        throw new Error(
            `Invalid configuration for the following fields:\n${parseResult.error.issues.map((issue) => `${issue.path.join(".")} - ${issue.message}`).join("\n")}`
        );
    }
    // We don't have as schema defined for all args-parser arguments so we need to merge the raw config with the parsed config.
    const userConfig = { ...rawConfig, ...parseResult.data } as UserConfig;

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
