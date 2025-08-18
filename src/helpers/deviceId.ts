import { getDeviceId } from "@mongodb-js/device-id";
import { LogId, LoggerBase } from "../common/logger.js";

export const DEVICE_ID_TIMEOUT = 3000;

/**
 * Singleton class for managing device ID retrieval and caching.
 * Starts device ID calculation early and is shared across all services.
 */
export class DeviceIdService {
    private static instance: DeviceIdService | undefined = undefined;
    private deviceId: string | undefined = undefined;
    private deviceIdPromise: Promise<string> | undefined = undefined;
    private abortController: AbortController | undefined = undefined;
    private logger: LoggerBase;
    private getMachineId: () => Promise<string>;

    private constructor(logger: LoggerBase, getMachineId: () => Promise<string>) {
        this.logger = logger;
        this.getMachineId = getMachineId;
        // Start device ID calculation immediately
        this.startDeviceIdCalculation();
    }

    /**
     * Initializes the DeviceIdService singleton with a logger.
     * A separated init method is used to use a single instance of the logger.
     * @param logger - The logger instance to use
     * @returns The DeviceIdService instance
     */
    public static init(logger: LoggerBase, getMachineId: () => Promise<string>): DeviceIdService {
        if (DeviceIdService.instance) {
            return DeviceIdService.instance;
        }
        DeviceIdService.instance = new DeviceIdService(logger, getMachineId);
        return DeviceIdService.instance;
    }

    /**
     * Gets the singleton instance of DeviceIdService.
     * @returns The DeviceIdService instance
     */
    public static getInstance(): DeviceIdService {
        if (!DeviceIdService.instance) {
            throw Error("DeviceIdService not initialized");
        }
        return DeviceIdService.instance;
    }

    /**
     * Resets the singleton instance (mainly for testing).
     */
    static resetInstance(): void {
        DeviceIdService.instance = undefined;
    }

    /**
     * Starts the device ID calculation process.
     * This method is called automatically in the constructor.
     */
    private startDeviceIdCalculation(): void {
        if (this.deviceIdPromise) {
            return;
        }

        this.abortController = new AbortController();
        this.deviceIdPromise = this.calculateDeviceId();
    }

    /**
     * Gets the device ID, waiting for the calculation to complete if necessary.
     * @returns Promise that resolves to the device ID string
     */
    public async getDeviceId(): Promise<string> {
        // Return cached value if available
        if (this.deviceId !== undefined) {
            return this.deviceId;
        }

        // If calculation is already in progress, wait for it
        if (this.deviceIdPromise) {
            return this.deviceIdPromise;
        }

        // If somehow we don't have a promise, raise an error
        throw new Error("Failed to get device ID");
    }
    /**
     * Aborts any ongoing device ID calculation.
     */
    abortCalculation(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }
        this.deviceIdPromise = undefined;
    }

    /**
     * Internal method that performs the actual device ID calculation.
     */
    private async calculateDeviceId(): Promise<string> {
        if (!this.abortController) {
            throw new Error("Device ID calculation not started");
        }

        try {
            const deviceId = await getDeviceId({
                getMachineId: this.getMachineId,
                onError: (reason, error) => {
                    switch (reason) {
                        case "resolutionError":
                            this.logger.debug({
                                id: LogId.telemetryDeviceIdFailure,
                                context: "deviceId",
                                message: `Device ID resolution error: ${String(error)}`,
                            });
                            break;
                        case "timeout":
                            this.logger.debug({
                                id: LogId.telemetryDeviceIdTimeout,
                                context: "deviceId",
                                message: "Device ID retrieval timed out",
                            });
                            break;
                        case "abort":
                            // No need to log in the case of aborts
                            break;
                    }
                },
                abortSignal: this.abortController.signal,
            });

            // Cache the result
            this.deviceId = deviceId;
            return deviceId;
        } catch (error) {
            // Check if this was an abort error
            if (error instanceof Error && error.name === "AbortError") {
                throw error; // Re-throw abort errors
            }

            this.logger.debug({
                id: LogId.telemetryDeviceIdFailure,
                context: "deviceId",
                message: `Failed to get device ID: ${String(error)}`,
            });

            // Cache the fallback value
            this.deviceId = "unknown";
            return "unknown";
        } finally {
            this.abortController = undefined;
        }
    }
}
