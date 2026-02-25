import { beforeEach, describe, expect, it, vi } from "vitest";
import { DebugResource } from "../../../../src/resources/common/debug.js";
import { Session } from "../../../../src/common/session.js";
import { Telemetry } from "../../../../src/telemetry/telemetry.js";
import { CompositeLogger } from "../../../../src/common/logger.js";
import { MCPConnectionManager } from "../../../../src/common/connectionManager.js";
import { ExportsManager } from "../../../../src/common/exportsManager.js";
import { DeviceId } from "../../../../src/helpers/deviceId.js";
import { Keychain } from "../../../../src/common/keychain.js";
import { VectorSearchEmbeddingsManager } from "../../../../src/common/search/vectorSearchEmbeddingsManager.js";
import { defaultTestConfig } from "../../../integration/helpers.js";
import { connectionErrorHandler } from "../../../../src/common/connectionErrorHandler.js";
import { defaultCreateApiClient } from "../../../../src/lib.js";

describe("debug resource", () => {
    const logger = new CompositeLogger();
    const deviceId = DeviceId.create(logger);
    const connectionManager = new MCPConnectionManager(defaultTestConfig, logger, deviceId);

    const session = vi.mocked(
        new Session({
            userConfig: defaultTestConfig,
            logger,
            exportsManager: ExportsManager.init(defaultTestConfig, logger),
            connectionManager,
            keychain: new Keychain(),
            connectionErrorHandler,
            apiClient: defaultCreateApiClient(
                {
                    baseUrl: defaultTestConfig.apiBaseUrl,
                    credentials: {
                        clientId: defaultTestConfig.apiClientId,
                        clientSecret: defaultTestConfig.apiClientSecret,
                    },
                },
                logger
            ),
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(defaultTestConfig, connectionManager),
        })
    );

    const telemetry = Telemetry.create(session, { ...defaultTestConfig, telemetry: "disabled" }, deviceId);

    let debugResource: DebugResource = new DebugResource(session, defaultTestConfig, telemetry);

    beforeEach(() => {
        debugResource = new DebugResource(session, defaultTestConfig, telemetry);
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
        vi.spyOn(session, "isSearchSupported").mockImplementation(() => Promise.resolve(true));
        debugResource.reduceApply("connect", undefined);
        const output = await debugResource.toOutput();

        expect(output).toContain(`The user is connected to the MongoDB cluster with support for search indexes.`);
    });
});
