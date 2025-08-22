import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
import { LogId, LoggerBase } from "../common/logger.js";

export const DEVICE_ID_TIMEOUT = 3000;

export class DeviceId {
    private deviceId: string | undefined = undefined;
    private deviceIdPromise: Promise<string> | undefined = undefined;
    private abortController: AbortController | undefined = undefined;
    private logger: LoggerBase;
    private readonly getMachineId: () => Promise<string>;
    private timeout: number;
    private static instance: DeviceId | undefined = undefined;

    private constructor(logger: LoggerBase, timeout: number = DEVICE_ID_TIMEOUT) {
        this.logger = logger;
        this.timeout = timeout;
        this.getMachineId = (): Promise<string> => nodeMachineId.machineId(true);
    }

    public static create(logger: LoggerBase, timeout?: number): DeviceId {
        if (this.instance) {
            throw new Error("DeviceId instance already exists, use get() to retrieve the device ID");
        }

        const instance = new DeviceId(logger, timeout ?? DEVICE_ID_TIMEOUT);
        instance.setup();

        this.instance = instance;

        return instance;
    }

    private setup(): void {
        this.deviceIdPromise = this.calculateDeviceId();
    }

    /**
     * Closes the device ID calculation promise and abort controller.
     */
    public close(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = undefined;
        }

        this.deviceId = undefined;
        this.deviceIdPromise = undefined;
        DeviceId.instance = undefined;
    }

    /**
     * Gets the device ID, waiting for the calculation to complete if necessary.
     * @returns Promise that resolves to the device ID string
     */
    public get(): Promise<string> {
        if (this.deviceId) {
            return Promise.resolve(this.deviceId);
        }

        if (this.deviceIdPromise) {
            return this.deviceIdPromise;
        }

        return this.calculateDeviceId();
    }

    /**
     * Internal method that performs the actual device ID calculation.
     */
    private async calculateDeviceId(): Promise<string> {
        if (!this.abortController) {
            this.abortController = new AbortController();
        }

        this.deviceIdPromise = getDeviceId({
            getMachineId: this.getMachineId,
            onError: (reason, error) => {
                this.handleDeviceIdError(reason, String(error));
            },
            timeout: this.timeout,
            abortSignal: this.abortController.signal,
        });

        return this.deviceIdPromise;
    }

    private handleDeviceIdError(reason: string, error: string): void {
        this.deviceIdPromise = Promise.resolve("unknown");

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
                // No need to log in the case of 'abort' errors
                break;
        }
    }
}
