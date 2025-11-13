import { generateConnectionInfoFromCliArgs, type ConnectionInfo } from "@mongosh/arg-parser";
import type { UserConfig } from "../config.js";

export type DriverOptions = ConnectionInfo["driverOptions"];
export const defaultDriverOptions: DriverOptions = {
    readConcern: {
        level: "local",
    },
    readPreference: "secondaryPreferred",
    writeConcern: {
        w: "majority",
    },
    timeoutMS: 30_000,
    proxy: { useEnvironmentVariableProxies: true },
    applyProxyToOIDC: true,
};

export function createDriverOptions(
    config: UserConfig,
    defaults: Partial<DriverOptions> = defaultDriverOptions
): DriverOptions {
    const { driverOptions } = generateConnectionInfoFromCliArgs(config);
    return {
        ...defaults,
        ...driverOptions,
    };
}
