import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MongoClient } from "mongodb";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { MCPConnectionManager } from "./connectionManager.js";
import { DeviceId } from "../helpers/deviceId.js";

vi.mock("@mongosh/service-provider-node-driver");

const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProvider);

describe("MCPConnectionManager.connect with an injected mongoClient", () => {
    const logger = new CompositeLogger();
    const deviceId = vi.mocked(DeviceId.create(new CompositeLogger()));

    function buildManager(): MCPConnectionManager {
        deviceId.get = vi.fn().mockResolvedValue("test-device-id");
        return new MCPConnectionManager({
            logger,
            deviceId,
            serverMetadata: { mcpServerName: "MongoDB MCP Server", version: "1.0.0" },
            connectionInfo: { transport: "stdio", httpHost: "127.0.0.1" },
        });
    }

    beforeEach(() => {
        MockNodeDriverServiceProvider.connect = vi.fn().mockResolvedValue({});
        // The auto-mocked class instance returned by `new` is a plain object.
        vi.mocked(MockNodeDriverServiceProvider.prototype).connect = vi.fn();
    });

    it("wraps a provided mongoClient directly, bypassing NodeDriverServiceProvider.connect (devtools-connect)", async () => {
        const manager = buildManager();
        const mongoClient = {} as MongoClient;

        const state = await manager.connect({
            connectionString: "mongodb://localhost:27017",
            mongoClient,
        });

        expect(state.tag).toBe("connected");
        // devtools-connect path must NOT be hit when a client is injected.
        expect(MockNodeDriverServiceProvider.connect).not.toHaveBeenCalled();
        // ...but the client is wrapped into a provider via the constructor.
        expect(MockNodeDriverServiceProvider).toHaveBeenCalled();
        const constructorArgs = vi.mocked(MockNodeDriverServiceProvider).mock.calls[0]?.[0];
        expect(constructorArgs).toBe(mongoClient);
    });

    it("still uses NodeDriverServiceProvider.connect when no mongoClient is provided", async () => {
        const manager = buildManager();

        await manager.connect({ connectionString: "mongodb://localhost:27017" });

        expect(MockNodeDriverServiceProvider.connect).toHaveBeenCalled();
    });

    it("rejects an injected mongoClient for an OIDC connection (the OIDC flow is not started)", async () => {
        const manager = buildManager();

        await expect(
            manager.connect({
                connectionString: "mongodb://localhost:27017?authMechanism=MONGODB-OIDC",
                mongoClient: {} as MongoClient,
            })
        ).rejects.toThrow(/Cannot inject a MongoClient for an OIDC connection/);
    });
});
