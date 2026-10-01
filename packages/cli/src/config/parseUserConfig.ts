import { type CliOptions, generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
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

export const defaultParserOptions: ParserOptions = {
    // This is the name of key that yargs-parser will look up in CLI
    // arguments (--config) and ENV variables (MDB_MCP_CONFIG) to load an
    // initial configuration from.
    config: "config",
    // This helps parse the relevant environment variables.
    envPrefix: "MDB_MCP_",
    configuration: {
        ...defaultArgParserOptions.configuration,
        // Consume multiple space-separated values for array options
        // (e.g. `--disabledTools find aggregate`).
        "greedy-arrays": true,
        // End-of-flag arguments are dropped before parsing (see
        // parseUserConfigSources), but in case any reach the parser, this keeps
        // them out of `_` so they're not mistaken for positional arguments.
        "populate--": true,
    },
};

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

    const connectionStringLikeArrayEntry = findConnectionStringLikeArrayEntry(parsed);
    if (connectionStringLikeArrayEntry) {
        return {
            error: `Error: The value '${connectionStringLikeArrayEntry.value}' in --${connectionStringLikeArrayEntry.key} looks like a connection string. A value following a list option is treated as a list entry, so provide the connection string as the first positional argument or via --connectionString / MDB_MCP_CONNECTION_STRING.`,
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
    // Arguments after a standalone `--` are end-of-flag arguments that are
    // irrelevant to us. They are dropped before parsing, as otherwise a greedy
    // array option preceding them would consume them as list entries.
    const endOfFlagsIndex = args.indexOf("--");
    const relevantArgs = endOfFlagsIndex === -1 ? args : args.slice(0, endOfFlagsIndex);

    let parsed: Partial<CliOptions & z.infer<T>>;
    let deprecated: Record<string, string>;
    try {
        const {
            parsed: parsedResult,
            deprecated: deprecatedResult,
            positional,
        } = createParseArgsWithCliOptions({
            schema,
            parserOptions,
        })({
            args: relevantArgs,
        });
        parsed = parsedResult;
        deprecated = deprecatedResult as Record<string, string>;

        // Greedy array options consume every value that follows them, including
        // ones that look like flags, so an unknown or mistyped flag would
        // silently become a list entry (e.g. `--disabledTools find --readonly`).
        const flagLikeArrayEntry = findFlagLikeArrayEntry(parsed);
        if (flagLikeArrayEntry) {
            return {
                error: unknownArgumentError(flagLikeArrayEntry),
                warnings: [],
                parsed: {},
            };
        }

        // At most one positional argument is valid: the connection specifier,
        // which mongosh's parser has already taken off `positional`.
        if (positional.length > 0) {
            return {
                error: `Error: Unexpected positional argument(s): ${positional
                    .map((arg) => `'${String(arg)}'`)
                    .join(", ")}. Only a connection string may be passed as a positional argument.`,
                warnings: [],
                parsed: {},
            };
        }

        if (parsed.file?.length) {
            return {
                error: "Error: The --file argument is not supported in the MCP Server. Please remove it from your configuration.",
                warnings: [],
                parsed: {},
            };
        }

        // Delete fileNames - this is a field populated by mongosh (from --file
        // and the leftover positional arguments) but not used by us.
        delete parsed.fileNames;
    } catch (error) {
        let errorMessage: string | undefined;
        if (error instanceof UnknownArgumentError) {
            errorMessage = unknownArgumentError(error.argument);
        }

        return {
            error: errorMessage,
            warnings: [],
            parsed: {},
        };
    }

    const deprecationWarnings = [
        ...getWarnings(parsed, relevantArgs),
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

function unknownArgumentError(argument: string): string {
    const matchingKey = matchingConfigKey(argument.replace(/^(--)/, ""));
    if (matchingKey) {
        return `Error: Invalid command line argument '${argument}'. Did you mean '--${matchingKey}'?`;
    }

    return `Error: Invalid command line argument '${argument}'.`;
}

function findFlagLikeArrayEntry(parsed: Record<string, unknown>): string | undefined {
    for (const [key, value] of Object.entries(parsed)) {
        if (key === "--" || !Array.isArray(value)) {
            continue;
        }
        for (const entry of value as unknown[]) {
            if (typeof entry === "string" && entry.startsWith("-")) {
                return entry;
            }
        }
    }
    return undefined;
}

function looksLikeConnectionString(value: string): boolean {
    return (
        value.startsWith("mongodb://") ||
        value.startsWith("mongodb+srv://") ||
        // A `host:port` pair, which mongosh also accepts as a connection
        // specifier. No tool name, operation type or category contains a colon.
        /^[^\s/:]+:\d+$/.test(value)
    );
}

function findConnectionStringLikeArrayEntry(
    parsed: Record<string, unknown>
): { key: string; value: string } | undefined {
    for (const [key, value] of Object.entries(parsed)) {
        if (key === "--" || !Array.isArray(value)) {
            continue;
        }
        for (const entry of value as unknown[]) {
            if (typeof entry !== "string") {
                continue;
            }
            const connectionStringLike = entry
                .split(",")
                .map((e) => e.trim())
                .find(looksLikeConnectionString);
            if (connectionStringLike) {
                return { key, value: connectionStringLike };
            }
        }
    }
    return undefined;
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

    // `connectionScope` is deprecated (the MCP protocol is moving to sessionless).
    // Warn when it is set explicitly via the CLI or the environment; the default
    // (and the eventual removed default) is "global".
    if (
        cliArguments.find((argument: string) => /^--connectionScope(?:=|$)/.test(argument)) ||
        process.env.MDB_MCP_CONNECTION_SCOPE
    ) {
        warnings.push(
            "Warning: The --connectionScope / MDB_MCP_CONNECTION_SCOPE option is deprecated: the MCP protocol is moving to sessionless, so it will soon be removed and the connection scope will default to 'global'. For shared-server use cases, use the Atlas-Managed MCP server or build an authenticated library using the @mongodb-js/mcp-cli package."
        );
    }

    return warnings;
}
