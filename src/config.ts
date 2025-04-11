import path from "path";
import os from "os";
import argv from "yargs-parser";

import packageJson from "../package.json" with { type: "json" };
import fs from "fs";
import { ReadConcernLevel, ReadPreferenceMode, W } from "mongodb";
import { log } from "console";

// If we decide to support non-string config options, we'll need to extend the mechanism for parsing
// env variables.
interface UserConfig {
    apiBaseUrl: string;
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
}

const defaults: UserConfig = {
    apiBaseUrl: "https://cloud.mongodb.com/",
    logPath: getLogPath(),
    connectOptions: {
        readConcern: "local",
        readPreference: "secondaryPreferred",
        writeConcern: "majority",
        timeoutMS: 30_000,
    },
};

const mergedUserConfig = {
    ...defaults,
    ...getEnvConfig(),
    ...getCliConfig(),
};

const config = {
    ...mergedUserConfig,
    atlasApiVersion: `2025-03-12`,
    version: packageJson.version,
    userAgent: `AtlasMCP/${packageJson.version} (${process.platform}; ${process.arch}; ${process.env.HOSTNAME || "unknown"})`,
};

export default config;

function getLogPath(): string {
    let localDataPath: string | undefined;

    if (process.platform === "win32") {
        const appData = process.env.APPDATA;
        const localAppData = process.env.LOCALAPPDATA ?? process.env.APPDATA;
        if (localAppData && appData) {
            localDataPath = path.join(localAppData, "mongodb", "mongodb-mcp");
        }
    }

    localDataPath ??= path.join(os.homedir(), ".mongodb", "mongodb-mcp");

    const logPath = path.join(localDataPath, ".app-logs");

    fs.mkdirSync(logPath, { recursive: true });

    return logPath;
}

// Gets the config supplied by the user as environment variables. The variable names
// are prefixed with `MDB_MCP_` and the keys match the UserConfig keys, but are converted
// to SNAKE_UPPER_CASE.
function getEnvConfig(): Partial<UserConfig> {
    function setValue(obj: Record<string, unknown>, path: string[], value: string): void {
        const currentField = path.shift()!;
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
    return argv(process.argv.slice(2)) as unknown as Partial<UserConfig>;
}
