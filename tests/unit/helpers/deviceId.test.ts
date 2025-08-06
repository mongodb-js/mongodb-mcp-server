/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDeviceIdForConnection, DEVICE_ID_TIMEOUT } from "../../../src/helpers/deviceId.js";
import { getDeviceId } from "@mongodb-js/device-id";
import nodeMachineId from "node-machine-id";
import logger, { LogId } from "../../../src/common/logger.js";

// Mock the dependencies
vi.mock("@mongodb-js/device-id");
vi.mock("node-machine-id");
vi.mock("../../../src/common/logger.js");

const MockGetDeviceId = vi.mocked(getDeviceId);
const MockNodeMachineId = vi.mocked(nodeMachineId);
const MockLogger = vi.mocked(logger);

describe("Device ID Helper", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        MockLogger.debug = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("getDeviceIdForConnection", () => {
        it("should successfully retrieve device ID", async () => {
            const mockDeviceId = "test-device-id-123";
            const mockMachineId = "machine-id-456";

            MockNodeMachineId.machineId.mockResolvedValue(mockMachineId);
            MockGetDeviceId.mockResolvedValue(mockDeviceId);

            const result = await getDeviceIdForConnection();

            expect(result).toBe(mockDeviceId);
            expect(MockGetDeviceId).toHaveBeenCalledWith({
                getMachineId: expect.any(Function),
                onError: expect.any(Function),
                abortSignal: expect.any(AbortSignal),
            });

            // Verify the getMachineId function works
            const callArgs = MockGetDeviceId.mock.calls[0]?.[0];
            if (callArgs?.getMachineId) {
                const getMachineIdFn = callArgs.getMachineId;
                expect(await getMachineIdFn()).toBe(mockMachineId);
            }
        });

        it("should return 'unknown' when getDeviceId throws an error", async () => {
            MockNodeMachineId.machineId.mockResolvedValue("machine-id");
            MockGetDeviceId.mockRejectedValue(new Error("Device ID resolution failed"));

            const result = await getDeviceIdForConnection();

            expect(result).toBe("unknown");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdFailure,
                "deviceId",
                "Failed to get device ID: Error: Device ID resolution failed"
            );
        });

        it("should handle resolution error callback", async () => {
            const mockMachineId = "machine-id";
            MockNodeMachineId.machineId.mockResolvedValue(mockMachineId);
            MockGetDeviceId.mockImplementation((options) => {
                // Simulate a resolution error
                if (options.onError) {
                    options.onError("resolutionError", new Error("Resolution failed"));
                }
                return Promise.resolve("device-id");
            });

            const result = await getDeviceIdForConnection();

            expect(result).toBe("device-id");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdFailure,
                "deviceId",
                "Error: Resolution failed"
            );
        });

        it("should handle timeout error callback", async () => {
            const mockMachineId = "machine-id";
            MockNodeMachineId.machineId.mockResolvedValue(mockMachineId);
            MockGetDeviceId.mockImplementation((options) => {
                // Simulate a timeout error
                if (options.onError) {
                    options.onError("timeout", new Error("Timeout"));
                }
                return Promise.resolve("device-id");
            });

            const result = await getDeviceIdForConnection();

            expect(result).toBe("device-id");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdTimeout,
                "deviceId",
                "Device ID retrieval timed out"
            );
        });

        it("should handle timeout with timer advancement", async () => {
            vi.useFakeTimers();

            const mockMachineId = "machine-id";
            MockNodeMachineId.machineId.mockResolvedValue(mockMachineId);
            MockGetDeviceId.mockImplementation((options) => {
                vi.advanceTimersByTime(DEVICE_ID_TIMEOUT / 2);
                if (options.onError) {
                    options.onError("timeout", new Error("Timeout"));
                }
                return Promise.resolve("device-id");
            });

            const result = await getDeviceIdForConnection();

            expect(result).toBe("device-id");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdTimeout,
                "deviceId",
                "Device ID retrieval timed out"
            );

            vi.useRealTimers();
        });

        it("should handle abort error callback without logging", async () => {
            const mockMachineId = "machine-id";
            MockNodeMachineId.machineId.mockResolvedValue(mockMachineId);
            MockGetDeviceId.mockImplementation((options) => {
                // Simulate an abort error
                if (options.onError) {
                    options.onError("abort", new Error("Aborted"));
                }
                return Promise.resolve("device-id");
            });

            const result = await getDeviceIdForConnection();

            expect(result).toBe("device-id");
            // Should not log abort errors
            expect(MockLogger.debug).not.toHaveBeenCalledWith(
                LogId.telemetryDeviceIdFailure,
                "deviceId",
                expect.stringContaining("Aborted")
            );
        });

        it("should handle machine ID generation failure", async () => {
            MockNodeMachineId.machineId.mockImplementation(() => {
                throw new Error("Machine ID generation failed");
            });
            // Also mock getDeviceId to throw to ensure we get the fallback
            MockGetDeviceId.mockRejectedValue(new Error("Device ID failed"));

            const result = await getDeviceIdForConnection();

            expect(result).toBe("unknown");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdFailure,
                "deviceId",
                "Failed to get device ID: Error: Device ID failed"
            );
        });

        it("should use AbortController signal", async () => {
            MockNodeMachineId.machineId.mockResolvedValue("machine-id");
            MockGetDeviceId.mockResolvedValue("device-id");

            await getDeviceIdForConnection();

            const callArgs = MockGetDeviceId.mock.calls[0]?.[0];
            if (callArgs) {
                expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
            }
        });

        it("should handle non-Error exceptions", async () => {
            MockNodeMachineId.machineId.mockResolvedValue("machine-id");
            MockGetDeviceId.mockRejectedValue("String error");

            const result = await getDeviceIdForConnection();

            expect(result).toBe("unknown");
            expect(MockLogger.debug).toHaveBeenCalledWith(
                LogId.telemetryDeviceIdFailure,
                "deviceId",
                "Failed to get device ID: String error"
            );
        });
    });
});
