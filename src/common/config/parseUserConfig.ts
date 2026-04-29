import { type CliOptions, generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { Keychain } from "@mongodb-js/mcp-core";
import type { Secret } from "@mongodb-js/mcp-core";
import { UserConfigSchema, ALL_CONFIG_KEYS, type UserConfig } from "./userConfig.js";
import {
    defaultParserOptions as defaultArgParserOptions,
    createParseArgsWithCliOptions,
    CliOptionsSchema,
    UnknownArgumentError,
} from "@mongosh/arg-parser/arg-parser";
import { z } from "zod";
import * as levenshteinModule from "ts-levenshtein";
const levenshtein = levenshteinModule.default;

export type ParserOptions = typeof defaultArgParserOptions;

export const defaultParserOptions = {
    // This is the name of key that yargs-parser will look up in CLI
    // arguments (--config) and ENV variables (MDB_MCP_CONFIG) to load an
    // initial configuration from.
    config: "config",
    // This helps parse the relevant environment variables.
    envPrefix: "MDB_MCP_",
    configuration: {
        ...defaultArgParserOptions.configuration,
        // To avoid populating `_` with end-of-flag arguments we explicitly
        // populate `--` variable and altogether ignore them later.
        "populate--": true,
    },
} satisfies ParserOptions;

export function parseUserConfig({
    args,
    overrides,
    parserOptions = defaultParserOptions,
}: {
    args: string[];
    overrides?: z.ZodRawShape;
    parserOptions?: ParserOptions;
}): {
    warnings: string[];
    parsed: UserConfig | undefined;
    error: string | undefined;
} {
    const schema = overrides
        ? z.object({
              ...UserConfigSchema.shape,
              ...overrides,
          })
        : UserConfigSchema;

    const { error: parseError, warnings, parsed } = parseUserConfigSources({ args, schema, parserOptions });

    if (parseError) {
        return { error: parseError, warnings, parsed: undefined };
    }

    if (parsed.nodb) {
        return {
            error: "Error: The --nodb argument is not supported in the MCP Server. Please remove it from your configuration.",
            warnings,
            parsed: undefined,
        };
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

    const configParseResult = schema.safeParse(parsed);
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
    registerKnownSecretsInRootKeychain(userConfig);
    return {
        parsed: userConfig,
        warnings,
        error: undefined,
    };
}

function parseUserConfigSources<T extends typeof UserConfigSchema>({
    args,
    schema = UserConfigSchema as T,
    parserOptions,
}: {
    args: string[];
    schema: T;
    parserOptions: ParserOptions;
}): {
    error: string | undefined;
    warnings: string[];
    parsed: Partial<CliOptions & z.infer<T>>;
} {
    let parsed: Partial<CliOptions & z.infer<T>>;
    let deprecated: Record<string, string>;
    try {
        const { parsed: parsedResult, deprecated: deprecatedResult } = createParseArgsWithCliOptions({
            schema,
            parserOptions,
        })({
            args,
        });
        parsed = parsedResult;
        deprecated = deprecatedResult as Record<string, string>;

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
        ...getWarnings(parsed, args),
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
    maybeRegister(userConfig.voyageApiKey, "password");
    maybeRegister(userConfig.connectionString, "mongodb uri");
}

function matchingConfigKey(key: string): string | undefined {
    let minLev = Number.MAX_VALUE;
    let suggestion = undefined;
    for (const validKey of ALL_CONFIG_KEYS) {
        const lev = levenshtein.get(key, validKey);
        // Accepting up to 2 typos and should be better than whatever previous
        // suggestion was.
        if (lev <= 2 && lev < minLev) {
            minLev = lev;
            suggestion = validKey;
        }
    }

    return suggestion;
}

function getWarnings(config: Partial<UserConfig>, cliArguments: string[]): string[] {
    const warnings = [];

    if (cliArguments.find((argument: string) => argument.startsWith("--connectionString"))) {
        warnings.push(
            "Warning: The --connectionString argument is deprecated. Prefer using the MDB_MCP_CONNECTION_STRING environment variable or the first positional argument for the connection string."
        );
    }

    return warnings;
}
