import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DeviceIdService } from "../../../src/helpers/deviceId.js";
import { CompositeLogger } from "../../../src/common/logger.js";
import nodeMachineId from "node-machine-id";

describe("Device ID", () => {
    let testLogger: CompositeLogger;

    beforeEach(() => {
        testLogger = new CompositeLogger();
        testLogger.debug = vi.fn();
    });

    afterEach(() => {
        if (DeviceIdService.isInitialized()) {
            DeviceIdService.getInstance().close();
        }
    });

    describe("when resolving device ID", () => {
        it("should successfully resolve device ID in real environment", async () => {
            const deviceId = DeviceIdService.init(testLogger);
            const result = await deviceId.getDeviceId();

            expect(result).not.toBe("unknown");
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        it("should cache device ID after first resolution", async () => {
            // spy on machineId
            const machineIdSpy = vi.spyOn(nodeMachineId, "machineId");
            const deviceId = DeviceIdService.init(testLogger);

            // First call
            const result1 = await deviceId.getDeviceId();
            expect(result1).not.toBe("unknown");

            // Second call should be cached
            const result2 = await deviceId.getDeviceId();
            expect(result2).toBe(result1);
            // check that machineId was called only once
            expect(machineIdSpy).toHaveBeenCalledOnce();
        });

        it("should handle concurrent device ID requests correctly", async () => {
            const deviceId = DeviceIdService.init(testLogger);

            const promises = Array.from({ length: 5 }, () => deviceId.getDeviceId());

            // All should resolve to the same value
            const results = await Promise.all(promises);
            const firstResult = results[0];
            expect(firstResult).not.toBe("unknown");

            // All results should be identical
            results.forEach((result) => {
                expect(result).toBe(firstResult);
            });
        });
    });

    describe("when resolving device ID fails", () => {
        const originalMachineId: typeof nodeMachineId.machineId = nodeMachineId.machineId;

        beforeEach(() => {
            // mock the machineId function to throw an abort error
            nodeMachineId.machineId = vi.fn();
        });

        afterEach(() => {
            // Restore original implementation
            nodeMachineId.machineId = originalMachineId;
        });

        it("should handle resolution errors gracefully", async () => {
            // mock the machineId function to throw a resolution error
            nodeMachineId.machineId = vi.fn().mockImplementation(() => {
                return new Promise<string>((resolve, reject) => {
                    reject(new Error("Machine ID failed"));
                });
            });
            const deviceId = DeviceIdService.init(testLogger);
            const handleDeviceIdErrorSpy = vi.spyOn(deviceId, "handleDeviceIdError" as keyof DeviceIdService);

            const result = await deviceId.getDeviceId();

            expect(result).toBe("unknown");
            expect(handleDeviceIdErrorSpy).toHaveBeenCalledWith(
                "resolutionError",
                expect.stringContaining("Machine ID failed")
            );
        });

        it("should handle abort signal scenarios gracefully", async () => {
            // slow down the machineId function to give time to send abort signal
            nodeMachineId.machineId = vi.fn().mockImplementation(() => {
                return new Promise<string>((resolve) => {
                    setTimeout(() => resolve("delayed-id"), 1000);
                });
            });

            const deviceId = DeviceIdService.init(testLogger);
            const handleDeviceIdErrorSpy = vi.spyOn(deviceId, "handleDeviceIdError" as keyof DeviceIdService);

            deviceId.close();

            // expect the deviceId service to throw an error
            await expect(deviceId.getDeviceId()).rejects.toThrow(Error);
            // test that the private function handleDeviceIdError was called with reason "abort"
            expect(handleDeviceIdErrorSpy).toHaveBeenCalledWith(
                "abort",
                expect.stringContaining("Aborted by abort signal")
            );

            // check that the deviceId service is not initialized anymore
            expect(() => DeviceIdService.getInstance()).toThrow(Error);
        });

        it("should handle timeout scenarios gracefully", async () => {
            nodeMachineId.machineId = vi.fn().mockImplementation(() => {
                return new Promise<string>((resolve) => {
                    setTimeout(() => resolve("delayed-id"), 200);
                });
            });

            // override the timeout to 100ms
            const deviceId = DeviceIdService.init(testLogger, 100);
            const handleDeviceIdErrorSpy = vi.spyOn(deviceId, "handleDeviceIdError" as keyof DeviceIdService);

            const result = await deviceId.getDeviceId();

            expect(result).toBe("unknown");
            expect(handleDeviceIdErrorSpy).toHaveBeenCalledWith("timeout", expect.stringContaining("Timeout"));
        }, 5000);
    });
});
