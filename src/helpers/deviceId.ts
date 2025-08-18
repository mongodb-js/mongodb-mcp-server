import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
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
    private readonly getMachineId: () => Promise<string>;
    private timeout: number;

    private constructor(logger: LoggerBase, timeout: number) {
        this.logger = logger;
        this.timeout = timeout;
        this.getMachineId = (): Promise<string> => nodeMachineId.machineId(true);
        // Start device ID calculation immediately
        this.startDeviceIdCalculation();
    }

    /**
     * Initializes the DeviceIdService singleton with a logger.
     * A separated init method is used to use a single instance of the logger.
     * @param logger - The logger instance to use
     * @returns The DeviceIdService instance
     */
    public static init(logger: LoggerBase, timeout?: number): DeviceIdService {
        if (DeviceIdService.instance) {
            return DeviceIdService.instance;
        }
        DeviceIdService.instance = new DeviceIdService(logger, timeout ?? DEVICE_ID_TIMEOUT);
        return DeviceIdService.instance;
    }

    /**
     * Checks if the DeviceIdService is initialized.
     * @returns True if the DeviceIdService is initialized, false otherwise
     */
    public static isInitialized(): boolean {
        return DeviceIdService.instance !== undefined;
    }

    /**
     * Gets the singleton instance of DeviceIdService.
     * @returns The DeviceIdService instance
     */
    public static getInstance(): DeviceIdService {
        if (!DeviceIdService.instance) {
            throw new Error("DeviceIdService not initialized");
        }
        return DeviceIdService.instance;
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
        if (this.deviceId !== undefined) {
            return this.deviceId;
        }

        if (!this.deviceIdPromise) {
            throw new Error("DeviceIdService calculation not started");
        }

        return this.deviceIdPromise;
    }
    /**
     * Aborts any ongoing device ID calculation.
     */
    public close(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }
        this.deviceId = undefined;
        this.deviceIdPromise = undefined;
        DeviceIdService.instance = undefined;
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
                    this.handleDeviceIdError(reason, String(error));
                },
                timeout: this.timeout,
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
                id: LogId.deviceIdResolutionError,
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

    /**
     * Handles device ID error.
     * @param reason - The reason for the error
     * @param error - The error object
     */
    private handleDeviceIdError(reason: string, error: string): void {
        switch (reason) {
            case "resolutionError":
                this.logger.debug({
                    id: LogId.deviceIdResolutionError,
                    context: "deviceId",
                    message: `Resolution error: ${String(error)}`,
                });
                break;
            case "timeout":
                this.logger.debug({
                    id: LogId.deviceIdTimeout,
                    context: "deviceId",
                    message: "Device ID retrieval timed out",
                    noRedaction: true,
                });
                break;
            case "abort":
                // No need to log in the case of aborts
                break;
        }
    }
}
