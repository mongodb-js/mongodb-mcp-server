import { type CliOptions, generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { Keychain } from "../keychain.js";
import type { Secret } from "../keychain.js";
import { matchingConfigKey } from "./configUtils.js";
import { UserConfigSchema, type UserConfig } from "./userConfig.js";
import {
    defaultParserOptions,
    parseArgsWithCliOptions,
    CliOptionsSchema,
    UnknownArgumentError,
} from "@mongosh/arg-parser/arg-parser";
import type { z as z4 } from "zod/v4";

export function createUserConfig({ args }: { args: string[] }): {
    warnings: string[];
    parsed: UserConfig | undefined;
    error: string | undefined;
} {
    const { error: parseError, warnings, parsed } = parseUserConfigSources(args);

    if (parseError) {
        return { error: parseError, warnings, parsed: undefined };
    }

    // If we have a connectionSpecifier, which can only appear as the positional
    // argument, then that has to be used on priority to construct the
    // connection string. In this case, if there is a connection string provided
    // by the env variable or config file, that will be overridden.
    const { connectionSpecifier } = parsed;
    if (connectionSpecifier) {
        const connectionInfo = generateConnectionInfoFromCliArgs({ ...parsed, connectionSpecifier });
        parsed.connectionString = connectionInfo.connectionString;
    }

    const configParseResult = UserConfigSchema.safeParse(parsed);
    const mongoshArguments = CliOptionsSchema.safeParse(parsed);
    const error = configParseResult.error || mongoshArguments.error;
    if (error) {
        return {
            error: `Invalid configuration for the following fields:\n${error.issues.map((issue) => `${issue.path.join(".")} - ${issue.message}`).join("\n")}`,
            warnings,
            parsed: undefined,
        };
    }

    // TODO: Separate correctly parsed user config from all other valid
    // arguments relevant to mongosh's args-parser.
    const userConfig: UserConfig = { ...parsed, ...configParseResult.data };
    warnings.push(...warnIfVectorSearchNotEnabledCorrectly(userConfig));
    registerKnownSecretsInRootKeychain(userConfig);
    return {
        parsed: userConfig,
        warnings,
        error: undefined,
    };
}

function parseUserConfigSources(cliArguments: string[]): {
    error: string | undefined;
    warnings: string[];
    parsed: Partial<CliOptions & z4.infer<typeof UserConfigSchema>>;
} {
    let parsed: Partial<CliOptions & z4.infer<typeof UserConfigSchema>>;
    let deprecated: Record<string, keyof UserConfig>;
    try {
        const { parsed: parsedResult, deprecated: deprecatedResult } = parseArgsWithCliOptions({
            args: cliArguments,
            schema: UserConfigSchema,
            parserOptions: {
                // This helps parse the relevant environment variables.
                envPrefix: "MDB_MCP_",
                configuration: {
                    ...defaultParserOptions.configuration,
                    // To avoid populating `_` with end-of-flag arguments we explicitly
                    // populate `--` variable and altogether ignore them later.
                    "populate--": true,
                },
            },
        });
        parsed = parsedResult;
        deprecated = deprecatedResult;

        // Delete fileNames - this is a field populated by mongosh but not used by us.
        delete parsed.fileNames;
    } catch (error) {
        let errorMessage: string | undefined;
        if (error instanceof UnknownArgumentError) {
            const matchingKey = matchingConfigKey(error.argument.replace(/^(--)/, ""));
            if (matchingKey) {
                errorMessage = `Error: Invalid command line argument '${error.argument}'. Did you mean '--${matchingKey}'?`;
            } else {
                errorMessage = `Error: Invalid command line argument '${error.argument}'.`;
            }
        }

        return {
            error: errorMessage,
            warnings: [],
            parsed: {},
        };
    }

    const deprecationWarnings = [
        ...(cliArguments.find((argument: string) => argument.startsWith("--connectionString"))
            ? [
                  "Warning: The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string.",
              ]
            : []),
        ...Object.entries(deprecated).map(([deprecated, replacement]) => {
            return `Warning: The --${deprecated} argument is deprecated. Use --${replacement} instead.`;
        }),
    ];

    return {
        error: undefined,
        warnings: deprecationWarnings,
        parsed,
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

function warnIfVectorSearchNotEnabledCorrectly(config: UserConfig): string[] {
    const searchEnabled = config.previewFeatures.includes("search");
    const embeddingsProviderConfigured = !!config.voyageApiKey;
    const warnings = [];
    if (searchEnabled && !embeddingsProviderConfigured) {
        warnings.push(`\
Warning: Vector search is enabled but no embeddings provider is configured.
- Set an embeddings provider configuration option to enable auto-embeddings during document insertion and text-based queries with $vectorSearch.\
`);
    }

    if (!searchEnabled && embeddingsProviderConfigured) {
        warnings.push(`\
Warning: An embeddings provider is configured but the 'search' preview feature is not enabled.
- Enable vector search by adding 'search' to the 'previewFeatures' configuration option, or remove the embeddings provider configuration if not needed.\
`);
    }
    return warnings;
}
