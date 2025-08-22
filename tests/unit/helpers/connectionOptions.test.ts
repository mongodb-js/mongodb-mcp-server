import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAppNameParamIfMissing } from "../../../src/helpers/connectionOptions.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { CompositeLogger } from "../../../src/common/logger.js";

const MockDeviceId = vi.mocked(DeviceId.create(new CompositeLogger()));

describe("Connection Options", () => {
    let testLogger: CompositeLogger;

    beforeEach(() => {
        testLogger = new CompositeLogger();
        testLogger.debug = vi.fn();
        MockDeviceId.get = vi.fn().mockResolvedValue("test-device-id");
    });

    describe("setAppNameParamIfMissing", () => {
        it("should set extended appName when no appName is present", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                    deviceId: MockDeviceId.get(),
                },
            });

            expect(result).toContain("appName=TestApp--test-device-id--TestClient");
        });

        it("should not modify connection string when appName is already present", async () => {
            const connectionString = "mongodb://localhost:27017?appName=ExistingApp";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                },
            });

            // The ConnectionString library normalizes URLs, so we need to check the content rather than exact equality
            expect(result).toContain("appName=ExistingApp");
            expect(result).not.toContain("TestApp--test-device-id--TestClient");
        });

        it("should use provided deviceId when available", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    deviceId: Promise.resolve("custom-device-id"),
                    clientName: "TestClient",
                },
            });

            expect(result).toContain("appName=TestApp--custom-device-id--TestClient");
        });

        it("should use 'unknown' for clientName when not provided", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    deviceId: MockDeviceId.get(),
                },
            });

            expect(result).toContain("appName=TestApp--test-device-id--unknown");
        });

        it("should use deviceId as unknown when deviceId is not provided", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                },
            });

            expect(result).toContain("appName=TestApp--unknown--TestClient");
        });

        it("should preserve other query parameters", async () => {
            const connectionString = "mongodb://localhost:27017?retryWrites=true&w=majority";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                    deviceId: MockDeviceId.get(),
                },
            });

            expect(result).toContain("retryWrites=true");
            expect(result).toContain("w=majority");
            expect(result).toContain("appName=TestApp--test-device-id--TestClient");
        });
    });
});
