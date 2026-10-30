import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { NodeDriverServiceProvider as NodeDriverServiceProviderImpl } from "@mongosh/service-provider-node-driver";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { MCPConnectionManager } from "./connectionManager.js";
import { DeviceId } from "../helpers/deviceId.js";

vi.mock("@mongosh/service-provider-node-driver");

const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProviderImpl);

const OIDC_CONNECTION_STRING = "mongodb://localhost:27017/?authMechanism=MONGODB-OIDC";

describe("MCPConnectionManager pending OIDC provider", () => {
    const logger = new CompositeLogger();
    const deviceId = vi.mocked(DeviceId.create(new CompositeLogger()));

    function buildManager(): MCPConnectionManager {
        deviceId.get = vi.fn().mockResolvedValue("test-device-id");
        return new MCPConnectionManager({
            logger,
            deviceId,
            serverMetadata: { mcpServerName: "MongoDB MCP Server", version: "1.0.0" },
            connectionInfo: { transport: "stdio", httpHost: "127.0.0.1", browser: "curl" },
        });
    }

    /** Makes the next provider dial return a promise the test settles by hand. */
    function gatedProvider(): {
        resolve: (provider: NodeDriverServiceProvider) => void;
        reject: (error: unknown) => void;
    } {
        let resolve!: (provider: NodeDriverServiceProvider) => void;
        let reject!: (error: unknown) => void;
        const provider = new Promise<NodeDriverServiceProvider>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        MockNodeDriverServiceProvider.connect = vi.fn().mockReturnValue(provider);
        return { resolve, reject };
    }

    beforeEach(() => {
        MockNodeDriverServiceProvider.connect = vi.fn();
    });

    it("resets the connection to errored when the pending provider rejects before auth starts", async () => {
        const provider = gatedProvider();
        const manager = buildManager();

        const state = await manager.connect({ connectionString: OIDC_CONNECTION_STRING });
        expect(state.tag).toBe("connecting");

        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            provider.reject(new Error("server selection timed out"));
            await vi.waitFor(() => {
                expect(manager.currentConnectionState).toMatchObject({
                    tag: "errored",
                    errorReason: "server selection timed out",
                });
            });
            // Give a stray unhandled rejection a chance to surface.
            await new Promise((resolve) => setTimeout(resolve, 0));
        } finally {
            process.off("unhandledRejection", unhandled);
        }

        expect(unhandled).not.toHaveBeenCalled();
    });

    it("redials once the rejected provider reset the connection to errored", async () => {
        const first = gatedProvider();
        const manager = buildManager();
        await manager.connect({ connectionString: OIDC_CONNECTION_STRING });
        first.reject(new Error("server selection timed out"));
        await vi.waitFor(() => expect(manager.currentConnectionState.tag).toBe("errored"));

        const second = gatedProvider();
        const state = await manager.connect({ connectionString: OIDC_CONNECTION_STRING });

        expect(state.tag).toBe("connecting");
        second.reject(new Error("still down"));
        await vi.waitFor(() => expect(manager.currentConnectionState.tag).toBe("errored"));
    });

    it("leaves a connection that is no longer connecting alone", async () => {
        const provider = gatedProvider();
        const manager = buildManager();
        await manager.connect({ connectionString: OIDC_CONNECTION_STRING });
        provider.reject(new Error("server selection timed out"));
        await vi.waitFor(() => expect(manager.currentConnectionState.tag).toBe("errored"));

        // Disconnecting an errored entry is a no-op, and the settled rejection
        // must not drag it back into `errored` (or any other state).
        await expect(manager.disconnect()).resolves.toMatchObject({ tag: "errored" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(manager.currentConnectionState.tag).toBe("errored");
    });
});
