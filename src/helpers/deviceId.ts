import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
import logger, { LogId } from "../common/logger.js";

export const DEVICE_ID_TIMEOUT = 3000;

/**
 * Retrieves the device ID for telemetry purposes.
 * The device ID is generated using the machine ID and additional logic to handle errors.
 *
 * @returns Promise that resolves to the device ID string
 * If an error occurs during retrieval, the function returns "unknown".
 *
 * @example
 * ```typescript
 * const deviceId = await getDeviceIdForConnection();
 * console.log(deviceId); // Outputs the device ID or "unknown" in case of failure
 * ```
 */
export async function getDeviceIdForConnection(): Promise<string> {
    const controller = new AbortController();

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
            abortSignal: controller.signal,
        });
        return deviceId;
    } catch (error) {
        logger.debug(LogId.telemetryDeviceIdFailure, "deviceId", `Failed to get device ID: ${String(error)}`);
        return "unknown";
    }
}
