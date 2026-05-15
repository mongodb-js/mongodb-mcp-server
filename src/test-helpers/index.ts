import { UserConfigSchema, type UserConfig } from "../common/config/userConfig.js";
import { packageInfo } from "../common/packageInfo.js";

export const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

/** Driver product labels for tests; mirrors root `packageInfo`. */
export const testConnectionManagerDriverLabels = {
    displayName: packageInfo.mcpServerName,
    version: packageInfo.version,
} as const;
