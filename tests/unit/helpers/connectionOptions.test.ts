import { describe, expect, it, vi } from "vitest";
import { setAppNameParamIfMissing } from "../../../src/helpers/connectionOptions.js";

// Mock the deviceId utility
vi.mock("../../../src/helpers/deviceId.js", () => ({
    getDeviceIdForConnection: vi.fn().mockResolvedValue("test-device-id"),
}));

describe("Connection Options", () => {
    describe("setAppNameParamIfMissing", () => {
        it("should set extended appName when no appName is present", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
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
                    deviceId: "custom-device-id",
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
                },
            });

            expect(result).toContain("appName=TestApp--test-device-id--unknown");
        });

        it("should use deviceId utility when deviceId is not provided", async () => {
            const connectionString = "mongodb://localhost:27017";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                },
            });

            expect(result).toContain("appName=TestApp--test-device-id--TestClient");
        });

        it("should preserve other query parameters", async () => {
            const connectionString = "mongodb://localhost:27017?retryWrites=true&w=majority";
            const result = await setAppNameParamIfMissing({
                connectionString,
                components: {
                    appName: "TestApp",
                    clientName: "TestClient",
                },
            });

            expect(result).toContain("retryWrites=true");
            expect(result).toContain("w=majority");
            expect(result).toContain("appName=TestApp--test-device-id--TestClient");
        });
    });
});
