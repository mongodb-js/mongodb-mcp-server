import type { CommonTransportRunnerConfig } from "./commonConfig.js";

export type V1TransportRunnerConfig = CommonTransportRunnerConfig & {
    /**
     * The schema version of the runner config. Set it `1` to signal that you're
     * providing the config compliant with V1 schema.
     */
    configVersion: 1;
};
