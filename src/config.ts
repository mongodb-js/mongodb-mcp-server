import path from "path";
import os from "os";
import argv from "yargs-parser";

import packageJson from "../package.json" with { type: "json" };
import { ReadConcernLevel, ReadPreferenceMode, W } from "mongodb";

// If we decide to support non-string config options, we'll need to extend the mechanism for parsing
// env variables.
interface UserConfig {
    apiBaseUrl?: string;
    apiClientId?: string;
    apiClientSecret?: string;
    logPath: string;
    connectionString?: string;
    connectOptions: {
        readConcern: ReadConcernLevel;
        readPreference: ReadPreferenceMode;
        writeConcern: W;
        timeoutMS: number;
    };
    disabledTools: Array<string>;
}

const defaults: UserConfig = {
    logPath: getLogPath(),
    connectOptions: {
        readConcern: "local",
        readPreference: "secondaryPreferred",
        writeConcern: "majority",
        timeoutMS: 30_000,
    },
    disabledTools: [],
};

const mergedUserConfig = {
    ...defaults,
    ...getEnvConfig(),
    ...getCliConfig(),
};

const config = {
    ...mergedUserConfig,
    version: packageJson.version,
};

export default config;

function getLogPath(): string {
    const localDataPath =
        process.platform === "win32"
            ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), "mongodb")
            : path.join(os.homedir(), ".mongodb");

    const logPath = path.join(localDataPath, "mongodb-mcp", ".app-logs");

    return logPath;
}

// Gets the config supplied by the user as environment variables. The variable names
// are prefixed with `MDB_MCP_` and the keys match the UserConfig keys, but are converted
// to SNAKE_UPPER_CASE.
function getEnvConfig(): Partial<UserConfig> {
    function setValue(obj: Record<string, unknown>, path: string[], value: string): void {
        const currentField = path.shift();
        if (!currentField) {
            return;
        }
        if (path.length === 0) {
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
    const mcpVariables = Object.entries(process.env).filter(
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

// Reads the cli args and parses them into a UserConfig object.
function getCliConfig() {
    return argv(process.argv.slice(2), {
        array: ["disabledTools"],
    }) as unknown as Partial<UserConfig>;
}
