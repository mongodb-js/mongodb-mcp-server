import { UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";
import { packageInfo } from "../common/packageInfo.js";

export const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

/** Server metadata for tests; mirrors root `packageInfo`. */
export const testServerMetadata = packageInfo;
