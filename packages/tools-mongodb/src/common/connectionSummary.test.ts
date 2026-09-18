import { beforeEach, describe, expect, it } from "vitest";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import { MCPConnectionStore, type ConnectionStoreConfig } from "./connectionStore.js";
import type { ConnectionManager } from "./connectionManager.js";
import type { ConnectionRegistry } from "./connectionRegistry.js";
import { DeviceId } from "../helpers/deviceId.js";
import { summarizeConnection } from "./connectionSummary.js";
import { FakeConnectionManager } from "./mocks/connectionManager.js";

const defaultTestConfig: ConnectionStoreConfig = {
    maxActiveConnections: 10,
    connectionIdleTimeoutMs: 600_000,
    transport: "stdio",
    httpHost: "127.0.0.1",
};

describe("summarizeConnection", () => {
    let logger: CompositeLogger;
    let managers: FakeConnectionManager[];
    let managerFactory: () => FakeConnectionManager;

    class TestStore extends MCPConnectionStore {
        protected override createConnectionManager(): ConnectionManager {
            const manager = managerFactory();
            managers.push(manager);
            return manager;
        }
    }

    function makeStore(): ConnectionRegistry {
        return new TestStore({
            options: defaultTestConfig,
            logger,
            deviceId: DeviceId.create(logger),
            keychain: new Keychain(),
        }).view();
    }

    beforeEach(() => {
        logger = new CompositeLogger();
        managers = [];
        managerFactory = (): FakeConnectionManager => new FakeConnectionManager();
    });

    it("never exposes the connection string or credentials (only auth/host type)", async () => {
        const registry = makeStore();
        const entry = await registry.createEntry({ name: "cluster0" });
        await entry.connect({
            connectionString: "mongodb+srv://mcpUser12345:s3cr3t@cluster0.example.com/?authSource=admin",
        });

        const summary = summarizeConnection(entry);
        const serialized = JSON.stringify(summary);

        // The summary carries only identity + auth/host metadata, never the URI or credentials.
        expect(serialized).not.toContain("s3cr3t");
        expect(serialized).not.toContain("mcpUser12345");
        expect(serialized).not.toContain("mongodb+srv://");
        expect(summary.state).toBe("connected");
        // describeConnection reduces the connection to auth/host type only.
        expect(summary.description).toContain("host type:");
        expect(summary.description).toContain("auth:");
        expect(summary.lastError).toBeUndefined();
    });

    it("keeps only a redacted lastError (no credential-bearing URI) when a dial fails", async () => {
        const registry = makeStore();

        const entry = await registry.createEntry({ name: "cluster0" });
        // The entry creation lazily minted a manager; fail the next dial with a
        // credential-bearing URI.
        managers.at(-1)!.failNextConnect = new Error(
            "connect to mongodb://mcpUser12345:s3cr3t@host.example.com:27017 failed"
        );
        await entry
            .connect({ connectionString: "mongodb://mcpUser12345:s3cr3t@host.example.com:27017" })
            .catch(() => {});

        const summary = summarizeConnection(entry);
        const serialized = JSON.stringify(summary);

        expect(summary.lastError).toBeDefined();
        expect(summary.lastError).not.toContain("s3cr3t");
        expect(summary.lastError).not.toContain("mcpUser12345");
        expect(serialized).not.toContain("s3cr3t");
    });

    it("never surfaces the connection string through list-connections text", async () => {
        const registry = makeStore();
        const entry = await registry.createEntry({ name: "cluster0" });
        await entry.connect({
            connectionString: "mongodb://user:Passw0rd@host.example.com:27017",
        });

        const summary = summarizeConnection(entry);
        expect(JSON.stringify(summary)).not.toContain("Passw0rd");
        expect(JSON.stringify(summary)).not.toContain("user@");
    });
});
