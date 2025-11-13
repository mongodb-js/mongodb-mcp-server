import path from "path";
import os from "os";
import { ALL_CONFIG_KEYS } from "./argsParserOptions.js";
import * as levenshteinModule from "ts-levenshtein";
const levenshtein = levenshteinModule.default;

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

export function isConnectionSpecifier(arg: string | undefined): boolean {
    return (
        arg !== undefined &&
        (arg.startsWith("mongodb://") ||
            arg.startsWith("mongodb+srv://") ||
            !(arg.endsWith(".js") || arg.endsWith(".mongodb")))
    );
}

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

    [key: string]: unknown;
};

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

    if (!Array.isArray(str)) {
        return [str] as T;
    }

    if (str.length === 1) {
        return str[0]
            ?.split(",")
            .map((e) => e.trim())
            .filter((e) => e.length > 0) as T;
    }

    return str as T;
}
