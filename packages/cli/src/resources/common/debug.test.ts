import { beforeEach, describe, expect, it, vi } from "vitest";
import { DebugResource } from "./debug.js";
import { Session } from "../../session.js";
import { UserConfigSchema, type UserConfig } from "../../config/userConfig.js";
import { connectionErrorHandler } from "@mongodb-js/mcp-tools-mongodb";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import { MCPConnectionManager, ExportsManager, DeviceId } from "@mongodb-js/mcp-tools-mongodb";

const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

const testConnectionManagerDriverLabels = {
    displayName: "test-server",
    version: "0.0.0",
} as const;

describe("debug resource", () => {
    const logger = new CompositeLogger();
    const deviceId = DeviceId.create(logger);
    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId,
        options: {
            connectionInfo: defaultTestConfig,
            ...testConnectionManagerDriverLabels,
        },
    });

    const session = vi.mocked(
        new Session({
            userConfig: defaultTestConfig,
            logger,
            exportsManager: ExportsManager.init({ options: defaultTestConfig, logger: logger }),
            connectionManager,
            keychain: new Keychain(),
            connectionErrorHandler,
            apiClient: new ApiClient({
                options: {
                    baseUrl: defaultTestConfig.apiBaseUrl,
                    userAgent: "test",
                },
                logger,
                authProvider: undefined,
            }),
        })
    );

    // Mock EventEmitter methods that ReactiveResource uses
    // @ts-expect-error - Session is not a MockedObject
    session.on = vi.fn();
    // Mock isSearchSupported that DebugResource.toOutput() uses
    session.isSearchSupported = vi.fn(() => Promise.resolve(false));

    const telemetry = AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient: session.apiClient,
        keychain: session.keychain,
        enabled: false,
        serverMetadata: { mcpServerName: "test-server", version: "0.0.0" },
    });

    let debugResource: DebugResource;

    beforeEach(() => {
        // Reset isSearchSupported mock before each test
        // eslint-disable-next-line @typescript-eslint/unbound-method
        vi.mocked(session.isSearchSupported).mockResolvedValue(false);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        debugResource = new DebugResource({ session: { ...session, config: defaultTestConfig }, telemetry } as any);
    });

    it("should be connected when a connected event happens", async () => {
        debugResource.reduceApply("connect", undefined);
        const output = await debugResource.toOutput();

        expect(output).toContain(
            `The user is connected to the MongoDB cluster without any support for search indexes.`
        );
    });

    it("should be disconnected when a disconnect event happens", async () => {
        debugResource.reduceApply("disconnect", undefined);
        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster.`);
    });

    it("should be disconnected when a close event happens", async () => {
        debugResource.reduceApply("close", undefined);
        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster.`);
    });

    it("should be disconnected and contain an error when an error event occurred", async () => {
        debugResource.reduceApply("connection-error", {
            tag: "errored",
            errorReason: "Error message from the server",
        });

        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster because of an error.`);
        expect(output).toContain(`<error>Error message from the server</error>`);
    });

    it("should show the inferred authentication type", async () => {
        debugResource.reduceApply("connection-error", {
            tag: "errored",
            connectionStringInfo: {
                authType: "scram",
                hostType: "local",
            },
            errorReason: "Error message from the server",
        });

        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster because of an error.`);
        expect(output).toContain(`The inferred authentication mechanism is "scram".`);
        expect(output).toContain(`<error>Error message from the server</error>`);
    });

    it("should show the atlas cluster information when provided", async () => {
        debugResource.reduceApply("connection-error", {
            tag: "errored",
            connectionStringInfo: {
                authType: "scram",
                hostType: "atlas",
            },
            errorReason: "Error message from the server",
            connectedAtlasCluster: {
                clusterName: "My Test Cluster",
                projectId: "COFFEEFABADA",
                username: "",
                instanceType: "FREE",
                expiryDate: new Date(),
            },
        });

        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster because of an error.`);
        expect(output).toContain(
            `Attempted connecting to Atlas Cluster "My Test Cluster" in project with id "COFFEEFABADA".`
        );
        expect(output).toContain(`The inferred authentication mechanism is "scram".`);
        expect(output).toContain(`<error>Error message from the server</error>`);
    });

    it("should notify if a cluster supports search indexes", async () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        vi.mocked(session.isSearchSupported).mockResolvedValue(true);
        debugResource.reduceApply("connect", undefined);
        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is connected to the MongoDB cluster with support for search indexes.`);
    });
});
