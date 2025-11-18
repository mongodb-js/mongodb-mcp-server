import argv from "yargs-parser";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { Keychain } from "../keychain.js";
import type { Secret } from "../keychain.js";
import { isConnectionSpecifier, matchingConfigKey } from "./configUtils.js";
import { OPTIONS } from "./argsParserOptions.js";
import { UserConfigSchema, type UserConfig } from "./userConfig.js";

export type CreateUserConfigHelpers = {
    onWarning: (message: string) => void;
    onError: (message: string) => void;
    closeProcess: (exitCode: number) => never;
    cliArguments: string[];
};

export const defaultUserConfigHelpers: CreateUserConfigHelpers = {
    onWarning(message) {
        console.warn(message);
    },
    onError(message) {
        console.error(message);
    },
    closeProcess(exitCode) {
        process.exit(exitCode);
    },
    cliArguments: process.argv.slice(2),
};

export function createUserConfig({
    onWarning = defaultUserConfigHelpers.onWarning,
    onError = defaultUserConfigHelpers.onError,
    closeProcess = defaultUserConfigHelpers.closeProcess,
    cliArguments = defaultUserConfigHelpers.cliArguments,
}: Partial<CreateUserConfigHelpers> = defaultUserConfigHelpers): UserConfig {
    const { unknownCliArgumentErrors, deprecatedCliArgumentWarning, userAndArgsParserConfig, connectionSpecifier } =
        parseUserConfigSources(cliArguments);

    if (unknownCliArgumentErrors.length) {
        const errorMessage = `
${unknownCliArgumentErrors.join("\n")}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.
`;
        onError(errorMessage);
        return closeProcess(1);
    }

    if (deprecatedCliArgumentWarning) {
        const deprecatedMessages = `
${deprecatedCliArgumentWarning}
- Refer to https://www.mongodb.com/docs/mcp-server/get-started/ for setting up the MCP Server.
`;
        onWarning(deprecatedMessages);
    }

    // If we have a connectionSpecifier, which can only appear as the positional
    // argument, then that has to be used on priority to construct the
    // connection string. In this case, if there is a connection string provided
    // by the env variable or config file, that will be overridden.
    if (connectionSpecifier) {
        const connectionInfo = generateConnectionInfoFromCliArgs({ ...userAndArgsParserConfig, connectionSpecifier });
        userAndArgsParserConfig.connectionString = connectionInfo.connectionString;
    }

    const configParseResult = UserConfigSchema.safeParse(userAndArgsParserConfig);
    if (configParseResult.error) {
        onError(
            `Invalid configuration for the following fields:\n${configParseResult.error.issues.map((issue) => `${issue.path.join(".")} - ${issue.message}`).join("\n")}`
        );
        return closeProcess(1);
    }

    // TODO: Separate correctly parsed user config from all other valid
    // arguments relevant to mongosh's args-parser.
    const userConfig: UserConfig = { ...userAndArgsParserConfig, ...configParseResult.data };
    warnIfVectorSearchNotEnabledCorrectly(userConfig, onWarning);
    registerKnownSecretsInRootKeychain(userConfig);
    return userConfig;
}

function parseUserConfigSources(cliArguments: string[]): {
    unknownCliArgumentErrors: string[];
    deprecatedCliArgumentWarning: string | undefined;
    userAndArgsParserConfig: Record<string, unknown>;
    connectionSpecifier: string | undefined;
} {
    const {
        _: positionalAndUnknownArguments,
        // We don't make use of end of flag arguments but also don't want them to
        // end up alongside unknown arguments so we are extracting them and having a
        // no-op statement so ESLint does not complain.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        "--": _endOfFlagArguments,
        ...parsedUserAndArgsParserConfig
    } = argv(cliArguments, {
        ...OPTIONS,
        // This helps parse the relevant environment variables.
        envPrefix: "MDB_MCP_",
        configuration: {
            ...OPTIONS.configuration,
            // Setting this to true will populate `_` variable which is
            // originally used for positional arguments, now with the unknown
            // arguments as well. The order of arguments are maintained.
            "unknown-options-as-args": true,
            // To avoid populating `_` with end-of-flag arguments we explicitly
            // populate `--` variable and altogether ignore them later.
            "populate--": true,
        },
    });

    // A connectionSpecifier can be one of:
    // - database name
    // - host name
    // - ip address
    // - replica set specifier
    // - complete connection string
    let connectionSpecifier: string | undefined = undefined;
    const [maybeConnectionSpecifier, ...unknownArguments] = positionalAndUnknownArguments;

    if (typeof maybeConnectionSpecifier === "string" && isConnectionSpecifier(maybeConnectionSpecifier)) {
        connectionSpecifier = maybeConnectionSpecifier;
    } else if (maybeConnectionSpecifier !== undefined) {
        // If the extracted connection specifier is not a connection specifier
        // indeed, then we push it back to the unknown arguments list. This might
        // happen for example when an unknown argument is provided without ever
        // specifying a positional argument.
        unknownArguments.unshift(maybeConnectionSpecifier);
    }

    return {
        unknownCliArgumentErrors: unknownArguments
            .filter((argument): argument is string => typeof argument === "string" && argument.startsWith("--"))
            .map((argument) => {
                const argumentKey = argument.replace(/^(--)/, "");
                const matchingKey = matchingConfigKey(argumentKey);
                if (matchingKey) {
                    return `Error: Invalid command line argument '${argument}'. Did you mean '--${matchingKey}'?`;
                }

                return `Error: Invalid command line argument '${argument}'.`;
            }),
        deprecatedCliArgumentWarning: cliArguments.find((argument) => argument.startsWith("--connectionString"))
            ? "Warning: The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string."
            : undefined,
        userAndArgsParserConfig: parsedUserAndArgsParserConfig,
        connectionSpecifier,
    };
}

function registerKnownSecretsInRootKeychain(userConfig: Partial<UserConfig>): void {
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

function warnIfVectorSearchNotEnabledCorrectly(config: UserConfig, warn: (message: string) => void): void {
    const vectorSearchEnabled = config.previewFeatures.includes("vectorSearch");
    const embeddingsProviderConfigured = !!config.voyageApiKey;
    if (vectorSearchEnabled && !embeddingsProviderConfigured) {
        warn(`\
Warning: Vector search is enabled but no embeddings provider is configured.
- Set an embeddings provider configuration option to enable auto-embeddings during document insertion and text-based queries with $vectorSearch.\
`);
    }

    if (!vectorSearchEnabled && embeddingsProviderConfigured) {
        warn(`\
Warning: An embeddings provider is configured but the 'vectorSearch' preview feature is not enabled.
- Enable vector search by adding 'vectorSearch' to the 'previewFeatures' configuration option, or remove the embeddings provider configuration if not needed.\
`);
    }
}
