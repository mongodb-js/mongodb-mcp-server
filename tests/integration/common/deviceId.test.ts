import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { CompositeLogger } from "../../../src/common/logger.js";
import nodeMachineId from "node-machine-id";

describe("Device ID", () => {
    let testLogger: CompositeLogger;
    let deviceId: DeviceId;

    beforeEach(() => {
        testLogger = new CompositeLogger();
        testLogger.debug = vi.fn();
    });

    afterEach(() => {
        deviceId?.close();
    });

    describe("when resolving device ID", () => {
        it("should successfully resolve device ID in real environment", async () => {
            deviceId = DeviceId.create(testLogger);
            const result = await deviceId.get();

            expect(result).not.toBe("unknown");
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        it("should cache device ID after first resolution", async () => {
            // spy on machineId
            const machineIdSpy = vi.spyOn(nodeMachineId, "machineId");
            deviceId = DeviceId.create(testLogger);

            // First call
            const result1 = await deviceId.get();
            expect(result1).not.toBe("unknown");

            // Second call should be cached
            const result2 = await deviceId.get();
            expect(result2).toBe(result1);
            // check that machineId was called only once
            expect(machineIdSpy).toHaveBeenCalledOnce();
        });

        it("should handle concurrent device ID requests correctly", async () => {
            deviceId = DeviceId.create(testLogger);

            const promises = Array.from({ length: 5 }, () => deviceId.get());

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
            deviceId = DeviceId.create(testLogger);
            const handleDeviceIdErrorSpy = vi.spyOn(deviceId, "handleDeviceIdError" as keyof DeviceId);

            const result = await deviceId.get();

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

            deviceId = DeviceId.create(testLogger, 100); // Short timeout
            const handleDeviceIdErrorSpy = vi.spyOn(deviceId, "handleDeviceIdError" as keyof DeviceId);

            const result = await deviceId.get();

            expect(result).toBe("unknown");
            expect(handleDeviceIdErrorSpy).toHaveBeenCalledWith("timeout", expect.any(String));
        });
    });
});
