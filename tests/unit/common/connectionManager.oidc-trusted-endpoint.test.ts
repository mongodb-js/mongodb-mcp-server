import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateConnectionInfoFromCliArgs } from "@mongosh/arg-parser";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { MCPConnectionManager } from "../../../src/common/connectionManager.js";
import { defaultTestConfig } from "../../integration/helpers.js";

vi.mock("@mongosh/service-provider-node-driver");
vi.mock("@mongosh/arg-parser", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@mongosh/arg-parser")>();
    return {
        ...actual,
        generateConnectionInfoFromCliArgs: vi.fn(actual.generateConnectionInfoFromCliArgs),
    };
});

const mockGenerateFn = vi.mocked(generateConnectionInfoFromCliArgs);
const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProvider);

describe("MCPConnectionManager.connect() — mongosh CLI option propagation", () => {
    beforeEach(() => {
        mockGenerateFn.mockClear();
        MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({} as unknown as NodeDriverServiceProvider);
    });

    it("passes oidcTrustedEndpoint from userConfig when no driverOptions are provided", async () => {
        const userConfig = {
            ...defaultTestConfig,
            oidcTrustedEndpoint: true,
        };

        const manager = new MCPConnectionManager(userConfig, {} as any, { get: async () => "test-device-id" });

        const connectionString = "mongodb://localhost:27017/";

        await manager.connect({ connectionString }).catch(() => {});

        expect(mockGenerateFn).toHaveBeenCalledWith(
            expect.objectContaining({
                oidcTrustedEndpoint: true,
                connectionSpecifier: expect.stringContaining("mongodb://localhost:27017/"),
            })
        );
    });

    it("does NOT pass oidcTrustedEndpoint when it is not set in userConfig", async () => {
        const userConfig = {
            ...defaultTestConfig,
            oidcTrustedEndpoint: undefined,
        };

        const manager = new MCPConnectionManager(userConfig, {} as any, { get: async () => "test-device-id" });

        const connectionString = "mongodb://localhost:27017/";

        await manager.connect({ connectionString }).catch(() => {});

        expect(mockGenerateFn).toHaveBeenCalledWith(
            expect.not.objectContaining({ oidcTrustedEndpoint: true })
        );
    });
});
