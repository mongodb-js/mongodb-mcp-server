import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
import { LogId, LoggerBase } from "../common/logger.js";

export const DEVICE_ID_TIMEOUT = 3000;

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
    }

    static create(
        logger: LoggerBase,
        { timeout = DEVICE_ID_TIMEOUT }: { timeout?: number } = {},
        ): DeviceIdService {        
        const instance = new DeviceIdService(logger, timeout);

        void instance.setup();
        return instance;
    }

    private async setup(): Promise<void> {
        this.abortController = new AbortController();

        this.deviceIdPromise = this.calculateDeviceId();
        const deviceId = await this.deviceIdPromise;
        this.deviceId = deviceId;
    }

    
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
