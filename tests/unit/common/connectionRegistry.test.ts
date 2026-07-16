import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    atlasClusterSlug,
    MCPConnectionStore,
    PRECONFIGURED_CONNECTION_ID,
    type ConnectionStoreOptions,
} from "../../../src/common/connectionRegistry.js";
import { summarizeConnection } from "../../../src/common/connectionSummary.js";
import { FakeConnectionManager } from "../mocks/connectionManager.js";
import { CompositeLogger } from "../../../src/common/logging/index.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";
import { defaultTestConfig } from "../../integration/helpers.js";

describe("ConnectionRegistry", () => {
    let managers: FakeConnectionManager[];

    function makeStore(overrides: Partial<ConnectionStoreOptions> = {}): MCPConnectionStore {
        return new MCPConnectionStore({
            userConfig: defaultTestConfig,
            logger: new CompositeLogger(),
            deviceId: DeviceId.create(new CompositeLogger()),
            createConnectionManager: (): FakeConnectionManager => {
                const manager = new FakeConnectionManager();
                managers.push(manager);
                return manager;
            },
            ...overrides,
        });
    }

    beforeEach(() => {
        managers = [];
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("connect", () => {
        it("returns an entry with an opaque id and a name derived from the host", async () => {
            const registry = makeStore().view();
            const entry = await registry.connect({
                settings: { connectionString: "mongodb://user:pass@my-host.example.com:27017/db" },
            });
            expect(entry.connectionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
            expect(entry.name).toMatch(/^my-host-example-com-[0-9a-f]{4}$/);
            expect(entry.source).toBe("explicit");
        });

        it("prefers the connectionName for the name slug", async () => {
            const registry = makeStore().view();
            const entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
                name: "Test Fixtures!",
            });
            expect(entry.name).toMatch(/^test-fixtures-[0-9a-f]{4}$/);
        });

        it("suffixes names so labels cannot be confused with the preconfigured id", async () => {
            const registry = makeStore().view();
            const entry = await registry.connect({
                settings: { connectionString: "mongodb://localhost:27017" },
                name: PRECONFIGURED_CONNECTION_ID,
            });
            expect(entry.name).toMatch(/^preconfigured-[0-9a-f]{4}$/);
            expect(entry.connectionId).not.toBe(PRECONFIGURED_CONNECTION_ID);
        });

        it("leaves no entry behind when the dial fails", async () => {
            const registry = makeStore({
                createConnectionManager: () => {
                    const manager = new FakeConnectionManager();
                    manager.failNextConnect = new Error("dial failed");
                    managers.push(manager);
                    return manager;
                },
            }).view();
            await expect(
                registry.connect({ settings: { connectionString: "mongodb://localhost:27017" } })
            ).rejects.toThrow("dial failed");
            await expect(registry.find(() => true)).resolves.toHaveLength(0);
        });
    });

    describe("resolve", () => {
        it("returns the service provider for a connected entry", async () => {
            const registry = makeStore().view();
            const entry = await registry.connect({ settings: { connectionString: "mongodb://localhost:27017" } });
            await expect(registry.resolve(entry.connectionId)).resolves.toEqual({ fake: true });
        });

        it("throws UnknownConnectionId for absent handles", async () => {
            const registry = makeStore().view();
            const error = await registry.resolve("nope-12345678").catch((e: unknown) => e);
            expect(error).toBeInstanceOf(MongoDBError);
            expect((error as MongoDBError).code).toBe(ErrorCodes.UnknownConnectionId);
        });
    });

    describe("preconfigured entry", () => {
        const config = { ...defaultTestConfig, connectionString: "mongodb://localhost:27017" };

        it("is seeded undialed when a connection string is configured", async () => {
            const registry = makeStore({ userConfig: config }).view();
            const summaries = (await registry.find(() => true)).map((entry) => summarizeConnection(entry));
            expect(summaries).toHaveLength(1);
            expect(summaries[0]?.connectionId).toBe(PRECONFIGURED_CONNECTION_ID);
            expect(summaries[0]?.source).toBe("preconfigured");
            expect(summaries[0]?.state).toBe("disconnected");
            expect(managers[0]?.connectCalls).toHaveLength(0);
        });

        it("is not seeded without a connection string", async () => {
            const registry = makeStore().view();
            await expect(registry.find(() => true)).resolves.toHaveLength(0);
        });

        it("dials lazily on first resolve and reuses the connection afterwards", async () => {
            const registry = makeStore({ userConfig: config }).view();
            await expect(registry.resolve(PRECONFIGURED_CONNECTION_ID)).resolves.toEqual({ fake: true });
            await expect(registry.resolve(PRECONFIGURED_CONNECTION_ID)).resolves.toEqual({ fake: true });
            expect(managers[0]?.connectCalls).toHaveLength(1);
        });

        it("survives disconnect and re-dials on next use", async () => {
            const registry = makeStore({ userConfig: config }).view();
            await registry.resolve(PRECONFIGURED_CONNECTION_ID);
            await expect(registry.disconnect(PRECONFIGURED_CONNECTION_ID)).resolves.toBeUndefined();
            const entry = await registry.peek(PRECONFIGURED_CONNECTION_ID);
            expect(entry).toBeDefined();
            expect(entry?.state.tag).toBe("disconnected");
            await expect(registry.resolve(PRECONFIGURED_CONNECTION_ID)).resolves.toEqual({ fake: true });
            expect(managers[0]?.connectCalls).toHaveLength(2);
        });

        it("reports a MisconfiguredConnectionString error when the dial fails", async () => {
            const registry = makeStore({ userConfig: config }).view();
            expect(managers[0]).toBeDefined();
            (managers[0] as FakeConnectionManager).failNextConnect = new Error("bad string");
            const error = await registry.resolve(PRECONFIGURED_CONNECTION_ID).catch((e: unknown) => e);
            expect((error as MongoDBError).code).toBe(ErrorCodes.MisconfiguredConnectionString);
            expect((await registry.peek(PRECONFIGURED_CONNECTION_ID))?.lastError).toBe("bad string");
        });
    });

    describe("disconnect", () => {
        it("revokes explicit entries and runs the onRevoke callback", async () => {
            const registry = makeStore().view();
            const onRevoke = vi.fn().mockResolvedValue(undefined);
            const entry = await registry.createEntry({ name: "revocable", onRevoke });
            await entry.connect({ connectionString: "mongodb://localhost:27017" });

            await expect(registry.disconnect(entry.connectionId)).resolves.toBeUndefined();
            await expect(registry.find(() => true)).resolves.toHaveLength(0);
            expect(onRevoke).toHaveBeenCalledOnce();
            expect(managers[0]?.closed).toBe(true);
        });

        it("throws UnknownConnectionId for unknown handles", async () => {
            const registry = makeStore().view();
            const error = await registry.disconnect("nope-12345678").catch((e: unknown) => e);
            expect(error).toBeInstanceOf(MongoDBError);
            expect((error as MongoDBError).code).toBe(ErrorCodes.UnknownConnectionId);
            expect((error as MongoDBError).message).toContain("does not exist or has expired");
        });
    });

    describe("maxActiveConnections", () => {
        it("revokes the least-recently-used explicit entry on overflow, never the preconfigured one", async () => {
            const registry = makeStore({
                userConfig: {
                    ...defaultTestConfig,
                    connectionString: "mongodb://localhost:27017",
                    maxActiveConnections: 2,
                },
            }).view();

            const first = await registry.connect({ settings: { connectionString: "mongodb://first:27017" } });
            vi.advanceTimersByTime(10);
            const second = await registry.connect({ settings: { connectionString: "mongodb://second:27017" } });
            vi.advanceTimersByTime(10);
            const third = await registry.connect({ settings: { connectionString: "mongodb://third:27017" } });

            const ids = (await registry.find(() => true)).map((entry) => entry.connectionId);
            expect(ids).toContain(PRECONFIGURED_CONNECTION_ID);
            expect(ids).toContain(second.connectionId);
            expect(ids).toContain(third.connectionId);
            expect(ids).not.toContain(first.connectionId);
            expect(ids).toHaveLength(3);
        });

        it("enforces the limit per scope, so one scope cannot evict another's entries", async () => {
            const store = makeStore({ userConfig: { ...defaultTestConfig, maxActiveConnections: 1 } });
            const viewA = store.view({ scope: "scope-a" });
            const viewB = store.view({ scope: "scope-b" });

            const bEntry = await viewB.connect({ settings: { connectionString: "mongodb://b-host:27017" } });
            vi.advanceTimersByTime(10);
            const aFirst = await viewA.connect({ settings: { connectionString: "mongodb://a-first:27017" } });
            vi.advanceTimersByTime(10);
            const aSecond = await viewA.connect({ settings: { connectionString: "mongodb://a-second:27017" } });

            const ids = (await store.view().find(() => true)).map((entry) => entry.connectionId);
            expect(ids).not.toContain(aFirst.connectionId);
            expect(ids).toContain(aSecond.connectionId);
            expect(ids).toContain(bEntry.connectionId);
            expect(ids).toHaveLength(2);
        });
    });

    describe("scoped views", () => {
        const scopedConfig = { ...defaultTestConfig, connectionString: "mongodb://localhost:27017" };

        it("hides entries created through one view from other views", async () => {
            const store = makeStore();
            const viewA = store.view({ scope: "scope-a" });
            const viewB = store.view({ scope: "scope-b" });

            const entry = await viewA.connect({ settings: { connectionString: "mongodb://localhost:27017" } });

            // Visible and usable through the creating view.
            await expect(viewA.peek(entry.connectionId)).resolves.toBe(entry);
            await expect(viewA.get(entry.connectionId)).resolves.toBe(entry);
            expect((await viewA.find(() => true)).map((e) => e.connectionId)).toContain(entry.connectionId);
            await expect(viewA.resolve(entry.connectionId)).resolves.toEqual({ fake: true });

            // Behaves exactly like an absent handle through any other view.
            await expect(viewB.peek(entry.connectionId)).resolves.toBeUndefined();
            await expect(viewB.get(entry.connectionId)).resolves.toBeUndefined();
            expect((await viewB.find(() => true)).map((e) => e.connectionId)).not.toContain(entry.connectionId);
            const resolveError = await viewB.resolve(entry.connectionId).catch((e: unknown) => e);
            expect(resolveError).toBeInstanceOf(MongoDBError);
            expect((resolveError as MongoDBError).code).toBe(ErrorCodes.UnknownConnectionId);
            expect((resolveError as MongoDBError).message).toContain("does not exist or has expired");
            const disconnectError = await viewB.disconnect(entry.connectionId).catch((e: unknown) => e);
            expect(disconnectError).toBeInstanceOf(MongoDBError);
            expect((disconnectError as MongoDBError).code).toBe(ErrorCodes.UnknownConnectionId);

            // The failed cross-scope disconnect must not have removed the entry.
            await expect(viewA.peek(entry.connectionId)).resolves.toBe(entry);
        });

        it("shows the preconfigured entry through every view", async () => {
            const store = makeStore({ userConfig: scopedConfig });
            const viewA = store.view({ scope: "scope-a" });
            const viewB = store.view({ scope: "scope-b" });

            expect((await viewA.find(() => true)).map((e) => e.connectionId)).toContain(PRECONFIGURED_CONNECTION_ID);
            expect((await viewB.find(() => true)).map((e) => e.connectionId)).toContain(PRECONFIGURED_CONNECTION_ID);
            await expect(viewA.resolve(PRECONFIGURED_CONNECTION_ID)).resolves.toEqual({ fake: true });
            await expect(viewB.resolve(PRECONFIGURED_CONNECTION_ID)).resolves.toEqual({ fake: true });
        });

        it("close revokes only the view's own entries (scoped views are owned by default)", async () => {
            const store = makeStore({ userConfig: scopedConfig });
            const viewA = store.view({ scope: "scope-a" });
            const viewB = store.view({ scope: "scope-b" });

            const aFirst = await viewA.connect({ settings: { connectionString: "mongodb://a-first:27017" } });
            const aSecond = await viewA.connect({ settings: { connectionString: "mongodb://a-second:27017" } });
            const bEntry = await viewB.connect({ settings: { connectionString: "mongodb://b-host:27017" } });

            await viewA.close();

            const ids = (await store.view().find(() => true)).map((entry) => entry.connectionId);
            expect(ids).not.toContain(aFirst.connectionId);
            expect(ids).not.toContain(aSecond.connectionId);
            expect(ids).toContain(bEntry.connectionId);
            expect(ids).toContain(PRECONFIGURED_CONNECTION_ID);
        });

        it("close is a no-op on an unowned view", async () => {
            const store = makeStore();
            const unowned = store.view();
            const entry = await unowned.connect({ settings: { connectionString: "mongodb://host:27017" } });

            await unowned.close();

            await expect(unowned.peek(entry.connectionId)).resolves.toBe(entry);
            expect(managers[0]?.closed).toBe(false);
        });

        it("close revokes everything reachable through an owned unbound view", async () => {
            const store = makeStore();
            const owned = store.view({ owned: true });
            const entry = await owned.connect({ settings: { connectionString: "mongodb://host:27017" } });

            await owned.close();

            await expect(owned.peek(entry.connectionId)).resolves.toBeUndefined();
            expect(managers[0]?.closed).toBe(true);
        });
    });

    describe("store closeAll", () => {
        it("closes and removes every entry, including the preconfigured one", async () => {
            const store = makeStore({
                userConfig: { ...defaultTestConfig, connectionString: "mongodb://localhost:27017" },
            });
            const scoped = store.view({ scope: "scope-a" });
            const unbound = store.view();

            const scopedEntry = await scoped.connect({ settings: { connectionString: "mongodb://a-host:27017" } });
            const sharedEntry = await unbound.connect({ settings: { connectionString: "mongodb://b-host:27017" } });
            await unbound.resolve(PRECONFIGURED_CONNECTION_ID);

            await store.closeAll();

            await expect(store.view().find(() => true)).resolves.toHaveLength(0);
            await expect(unbound.peek(scopedEntry.connectionId)).resolves.toBeUndefined();
            await expect(unbound.peek(sharedEntry.connectionId)).resolves.toBeUndefined();
            await expect(unbound.peek(PRECONFIGURED_CONNECTION_ID)).resolves.toBeUndefined();
            expect(managers.every((manager) => manager.closed)).toBe(true);
        });
    });

    describe("atlasClusterSlug", () => {
        it("combines the project and cluster names", () => {
            expect(atlasClusterSlug("Test Project", "Cluster0")).toBe("test-project-cluster0");
        });

        it("uses the cluster name alone when the project name is unknown", () => {
            expect(atlasClusterSlug(undefined, "Cluster0")).toBe("cluster0");
        });

        it("truncates the project half so the full cluster slug survives within the budget", () => {
            const slug = atlasClusterSlug("An Extremely Long Atlas Project Name That Never Ends", "Cluster0");
            expect(slug.length).toBeLessThanOrEqual(40);
            expect(slug.endsWith("-cluster0")).toBe(true);
        });
    });
});
