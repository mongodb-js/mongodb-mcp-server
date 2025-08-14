import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
import logger, { LogId } from "../common/logger.js";

export const DEVICE_ID_TIMEOUT = 3000;

/**
 * Sets the appName parameter with the extended format: appName--deviceId--clientName
 * Only sets the appName if it's not already present in the connection string
 *
 * @param connectionString - The connection string to modify
 * @param components - The components to build the appName from
 * @returns Promise that resolves to the modified connection string
 *
 * @example
 * ```typescript
 * const result = await setExtendedAppNameParam({
 *   connectionString: "mongodb://localhost:27017",
 *   components: { appName: "MyApp", clientName: "Cursor" }
 * });
 * // Result: "mongodb://localhost:27017/?appName=MyApp--deviceId--Cursor"
 * ```
 */
export async function getDeviceIdForConnection(): Promise<string> {
    try {
        const deviceId = await getDeviceId({
            getMachineId: () => nodeMachineId.machineId(true),
            onError: (reason, error) => {
                switch (reason) {
                    case "resolutionError":
                        logger.debug(LogId.telemetryDeviceIdFailure, "deviceId", String(error));
                        break;
                    case "timeout":
                        logger.debug(LogId.telemetryDeviceIdTimeout, "deviceId", "Device ID retrieval timed out");
                        break;
                    case "abort":
                        // No need to log in the case of aborts
                        break;
                }
            },
            abortSignal: new AbortController().signal,
        });
        return deviceId;
    } catch (error) {
        logger.debug(LogId.telemetryDeviceIdFailure, "deviceId", `Failed to get device ID: ${String(error)}`);
        return "unknown";
    }
}
