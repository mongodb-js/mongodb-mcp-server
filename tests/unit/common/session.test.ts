import { beforeEach, describe, expect, it, vi } from "vitest";
import { Session } from "../../../src/common/session.js";
import { CompositeLogger } from "../../../src/common/logging/index.js";
import { ExportsManager } from "../../../src/common/exportsManager.js";
import { MCPConnectionStore } from "../../../src/common/connectionStore.js";
import type { ConnectionRegistry } from "../../../src/common/connectionRegistry.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { Keychain } from "../../../src/common/keychain.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import { connectionErrorHandler } from "../../../src/common/connectionErrorHandler.js";
import type { ApiClient } from "../../../src/common/atlas/apiClient.js";
import { FakeConnectionManager } from "../mocks/connectionManager.js";

describe("Session", () => {
    let session: Session;
    let exportsManager: ExportsManager;
    let connectionRegistry: ConnectionRegistry;
    let apiClientCloseMock: ReturnType<typeof vi.fn<() => Promise<void>>>;

    beforeEach(() => {
        const logger = new CompositeLogger();

        exportsManager = ExportsManager.init(defaultTestConfig, logger);
        connectionRegistry = new MCPConnectionStore({
            userConfig: defaultTestConfig,
            logger,
            deviceId: DeviceId.create(logger),
            createConnectionManager: (): FakeConnectionManager => new FakeConnectionManager(),
        }).view();
        apiClientCloseMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        session = new Session({
            logger,
            exportsManager,
            connectionRegistry,
            keychain: new Keychain(),
            connectionErrorHandler,
            apiClient: { close: apiClientCloseMock } as unknown as ApiClient,
        });
    });

    describe("construction", () => {
        it("generates a unique sessionId", () => {
            const other = new Session({
                logger: session.logger,
                exportsManager,
                connectionRegistry,
                keychain: new Keychain(),
                connectionErrorHandler,
                apiClient: { close: vi.fn() } as unknown as ApiClient,
            });

            expect(session.sessionId).toMatch(/^[0-9a-f]{24}$/);
            expect(other.sessionId).not.toBe(session.sessionId);
        });

        it("exposes the shared connection registry", () => {
            expect(session.connectionRegistry).toBe(connectionRegistry);
        });
    });

    describe("setMcpClient", () => {
        it("stores the client information", () => {
            session.setMcpClient({ name: "test-client", version: "1.2.3", title: "Test Client" });

            expect(session.mcpClient).toEqual({ name: "test-client", version: "1.2.3", title: "Test Client" });
        });

        it("defaults missing fields to 'unknown'", () => {
            session.setMcpClient({ name: "test-client", version: "" });

            expect(session.mcpClient).toEqual({ name: "test-client", version: "unknown", title: "unknown" });
        });

        it("defaults everything to 'unknown' when no client info is provided", () => {
            session.setMcpClient(undefined);

            expect(session.mcpClient).toEqual({ name: "unknown", version: "unknown", title: "unknown" });
        });
    });

    describe("close", () => {
        it("closes the api client and the exports manager and emits the close event", async () => {
            const exportsManagerCloseSpy = vi.spyOn(exportsManager, "close");
            const closeListener = vi.fn();
            session.on("close", closeListener);

            await session.close();

            expect(apiClientCloseMock).toHaveBeenCalledOnce();
            expect(exportsManagerCloseSpy).toHaveBeenCalledOnce();
            expect(closeListener).toHaveBeenCalledOnce();
        });

        it("closes the connection registry before the api client", async () => {
            const callOrder: string[] = [];
            const registryCloseSpy = vi.spyOn(connectionRegistry, "close").mockImplementation(() => {
                callOrder.push("registry");
                return Promise.resolve();
            });
            apiClientCloseMock.mockImplementation(() => {
                callOrder.push("apiClient");
                return Promise.resolve();
            });

            await session.close();

            expect(registryCloseSpy).toHaveBeenCalledOnce();
            // Revoking Atlas entries deletes their temp users through the API
            // client, so connections must close while the client still works.
            expect(callOrder).toEqual(["registry", "apiClient"]);
        });
    });
});
