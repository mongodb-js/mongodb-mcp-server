import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { getDeviceId } from "@mongodb-js/device-id";
import { CompositeLogger } from "../../../src/common/logger.js";

// Mock the dependencies
vi.mock("@mongodb-js/device-id");
vi.mock("node-machine-id");
const MockGetDeviceId = vi.mocked(getDeviceId);

describe("deviceId", () => {
    let testLogger: CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        testLogger = new CompositeLogger();
    });

    afterEach(() => {
        DeviceId.create(testLogger).close();

        vi.restoreAllMocks();
    });

    it("should create not separate instances", () => {
        const instance1 = DeviceId.create(testLogger);
        const instance2 = DeviceId.create(testLogger);

        expect(instance1).toBe(instance2);
    });

    it("should successfully retrieve device ID", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        const deviceId = DeviceId.create(testLogger);
        const result = await deviceId.get();

        expect(result).toBe(mockDeviceId);
    });

    it("should cache device ID after first retrieval", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        const deviceId = DeviceId.create(testLogger);

        // First call should trigger calculation
        const result1 = await deviceId.get();
        expect(result1).toBe(mockDeviceId);
        expect(MockGetDeviceId).toHaveBeenCalledTimes(1);

        // Second call should use cached value
        const result2 = await deviceId.get();
        expect(result2).toBe(mockDeviceId);
        expect(MockGetDeviceId).toHaveBeenCalledTimes(1); // Still only called once
    });

    it("should allow aborting calculation", async () => {
        MockGetDeviceId.mockImplementation((options) => {
            // Simulate a long-running operation that can be aborted
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => resolve("device-id"), 1000);
                options.abortSignal?.addEventListener("abort", () => {
                    clearTimeout(timeout);
                    const abortError = new Error("Aborted");
                    abortError.name = "AbortError";
                    reject(abortError);
                });
            });
        });

        const deviceId = DeviceId.create(testLogger);

        // Start calculation
        const promise = deviceId.get();

        // Abort the calculation
        deviceId.close();

        // Should reject with AbortError
        await expect(promise).rejects.toThrow("Aborted");
    });

    it("should handle resolution errors gracefully", async () => {
        MockGetDeviceId.mockRejectedValue(new Error("Resolution failed"));

        const deviceId = DeviceId.create(testLogger);
        const result = await deviceId.get();

        expect(result).toBe("unknown");
    });

    it("should handle timeout errors gracefully", async () => {
        MockGetDeviceId.mockImplementation((options) => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const timeoutError = new Error("Timeout");
                    timeoutError.name = "TimeoutError";
                    reject(timeoutError);
                }, 100);
                options.abortSignal?.addEventListener("abort", () => {
                    clearTimeout(timeout);
                });
            });
        });

        const deviceId = DeviceId.create(testLogger, 50); // Short timeout
        const result = await deviceId.get();

        expect(result).toBe("unknown");
    });

    it("should use custom timeout", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        const deviceId = DeviceId.create(testLogger, 5000);
        const result = await deviceId.get();

        expect(result).toBe(mockDeviceId);
        expect(MockGetDeviceId).toHaveBeenCalledWith(
            expect.objectContaining({
                timeout: 5000,
            })
        );
    });

    it("should use default timeout when not specified", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        const deviceId = DeviceId.create(testLogger);
        const result = await deviceId.get();

        expect(result).toBe(mockDeviceId);
        expect(MockGetDeviceId).toHaveBeenCalledWith(
            expect.objectContaining({
                timeout: 3000, // DEVICE_ID_TIMEOUT
            })
        );
    });

    it("should handle multiple close calls gracefully", () => {
        const deviceId = DeviceId.create(testLogger);

        // First close should work
        expect(() => deviceId.close()).not.toThrow();

        // Second close should also work without error
        expect(() => deviceId.close()).not.toThrow();
    });

    it("should not throw error when get is called after close", async () => {
        const deviceId = DeviceId.create(testLogger);
        deviceId.close();

        await expect(deviceId.get()).rejects.toThrow("Device ID calculation not started");
    });
});
