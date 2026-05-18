import path from "path";
import os from "os";

// Re-export generic utilities from mcp-cli
export {
    commaSeparatedToArray,
    parseBoolean,
    oneWayOverride,
    onlyLowerThanBaseValueOverride,
    onlyStricterLogLevelOverride,
    onlySubsetOfBaseValueOverride,
    type CustomOverrideLogic,
    type OverrideBehavior,
    type ConfigFieldMeta,
} from "@mongodb-js/mcp-cli";

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
