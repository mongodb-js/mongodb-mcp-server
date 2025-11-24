import path from "path";
import os from "os";
import { ALL_CONFIG_KEYS } from "./argsParserOptions.js";
import * as levenshteinModule from "ts-levenshtein";
const levenshtein = levenshteinModule.default;

/// Custom logic function to apply the override value.
/// Returns the value to use (which may be transformed from newValue).
/// Should throw an error if the override cannot be applied.
export type CustomOverrideLogic = (oldValue: unknown, newValue: unknown) => unknown;

/**
 * Defines how a config field can be overridden via HTTP headers or query parameters.
 */
export type OverrideBehavior =
    /// Cannot be overridden via request
    | "not-allowed"
    /// Can be completely replaced
    | "override"
    /// Values are merged (for arrays)
    | "merge"
    | CustomOverrideLogic;

/**
 * Metadata for config schema fields.
 */
export type ConfigFieldMeta = {
    /**
     * Custom description for the default value, used when generating documentation.
     */
    defaultValueDescription?: string;
    /**
     * Marks the field as containing sensitive/secret information, used for MCP Registry.
     * Secret fields will be marked as secret in environment variable definitions.
     */
    isSecret?: boolean;
    /**
     * Defines how this config field can be overridden via HTTP headers or query parameters.
     * Defaults to "not-allowed" for security.
     */
    overrideBehavior?: OverrideBehavior;
    [key: string]: unknown;
};

export function matchingConfigKey(key: string): string | undefined {
    let minLev = Number.MAX_VALUE;
    let suggestion = undefined;
    for (const validKey of ALL_CONFIG_KEYS) {
        const lev = levenshtein.get(key, validKey);
        // Accepting upto 2 typos and should be better than whatever previous
        // suggestion was.
        if (lev <= 2 && lev < minLev) {
            minLev = lev;
            suggestion = validKey;
        }
    }

    return suggestion;
}

export function isConnectionSpecifier(arg: string | undefined): boolean {
    return (
        arg !== undefined &&
        (arg.startsWith("mongodb://") ||
            arg.startsWith("mongodb+srv://") ||
            // Strings starting with double hyphens `--` are generally a sign of
            // CLI flag so we exclude them from the possibility of being a
            // connection specifier.
            !(arg.endsWith(".js") || arg.endsWith(".mongodb") || arg.startsWith("--")))
    );
}

export function getLocalDataPath(): string {
    return process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), "mongodb")
        : path.join(os.homedir(), ".mongodb");
}

export function getLogPath(): string {
    const logPath = path.join(getLocalDataPath(), "mongodb-mcp", ".app-logs");
    return logPath;
}

export function getExportsPath(): string {
    return path.join(getLocalDataPath(), "mongodb-mcp", "exports");
}

export function commaSeparatedToArray<T extends string[]>(str: string | string[] | undefined): T | undefined {
    if (str === undefined) {
        return undefined;
    }

    if (typeof str === "string") {
        return str
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0) as T;
    }

    if (str.length === 1) {
        return str[0]
            ?.split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0) as T;
    }

    return str as T;
}

/**
 * Preprocessor for boolean values that handles string "true"/"false" correctly.
 * Zod's coerce.boolean() treats any non-empty string as true, which is not what we want.
 */
export function parseBoolean(val: unknown): unknown {
    if (typeof val === "string") {
        const lower = val.toLowerCase().trim();
        if (lower === "false" || lower === "0") return false;
        if (lower === "true" || lower === "1") return true;
    }
    if (typeof val === "boolean") {
        return val;
    }
    if (typeof val === "number") {
        return val !== 0;
    }
    return !!val;
}

/** Allow overriding only to the allowed value */
export function oneWayOverride<T>(allowedValue: T): CustomOverrideLogic {
    return (oldValue, newValue) => {
        // Only allow override if setting to allowed value
        if (newValue === allowedValue) {
            return newValue;
        }
        throw new Error(`Can only set to ${String(allowedValue)}`);
    };
}
