import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DeviceIdService } from "../../../src/helpers/deviceId.js";
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
        vi.restoreAllMocks();
        if (DeviceIdService.isInitialized()) {
            DeviceIdService.getInstance().close();
        }
    });

    it("should return the same instance for multiple getInstance calls", () => {
        // Initialize first
        DeviceIdService.init(testLogger);

        const instance1 = DeviceIdService.getInstance();
        const instance2 = DeviceIdService.getInstance();

        expect(instance1).toBe(instance2);
    });

    it("should correctly report initialization status", () => {
        expect(DeviceIdService.isInitialized()).toBe(false);
        
        DeviceIdService.init(testLogger);
        expect(DeviceIdService.isInitialized()).toBe(true);
        
        DeviceIdService.getInstance().close();
        expect(DeviceIdService.isInitialized()).toBe(false);
    });

    it("should throw error when getInstance is called before init", () => {
        expect(() => DeviceIdService.getInstance()).toThrow("DeviceIdService not initialized");
    });

    it("should successfully retrieve device ID", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();
        const result = await deviceId.getDeviceId();

        expect(result).toBe(mockDeviceId);
    });

    it("should cache device ID after first retrieval", async () => {
        const mockDeviceId = "test-device-id-123";
        MockGetDeviceId.mockResolvedValue(mockDeviceId);

        // Initialize after mocking
        const deviceId = DeviceIdService.init(testLogger);
        // First call should trigger calculation
        const result1 = await deviceId.getDeviceId();
        expect(result1).toBe(mockDeviceId);
        expect(MockGetDeviceId).toHaveBeenCalledTimes(1);

        // Second call should use cached value
        const result2 = await deviceId.getDeviceId();
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

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();

        // Start calculation
        const promise = deviceId.getDeviceId();

        // Abort immediately
        deviceId.close();

        // Should reject with AbortError
        await expect(promise).rejects.toThrow("Aborted");
    });

    it("should return 'unknown' when getDeviceId throws an error", async () => {
        MockGetDeviceId.mockRejectedValue(new Error("Device ID resolution failed"));

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();
        const result = await deviceId.getDeviceId();

        expect(result).toBe("unknown");
    });

    it("should handle machine ID generation failure", async () => {
        MockGetDeviceId.mockRejectedValue(new Error("Device ID failed"));

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();
        const result = await deviceId.getDeviceId();

        expect(result).toBe("unknown");
    });

    it("should use AbortController signal", async () => {
        MockGetDeviceId.mockResolvedValue("device-id");

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();
        await deviceId.getDeviceId();

        const callArgs = MockGetDeviceId.mock.calls[0]?.[0];
        if (callArgs) {
            expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
        }
    });

    it("should handle non-Error exceptions", async () => {
        MockGetDeviceId.mockRejectedValue("String error");

        // Initialize after mocking
        DeviceIdService.init(testLogger);

        const deviceId = DeviceIdService.getInstance();
        const result = await deviceId.getDeviceId();

        expect(result).toBe("unknown");
    });
});
