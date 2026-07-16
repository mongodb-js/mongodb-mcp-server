import { describe, expect, it, vi } from "vitest";
import { ConfigResource } from "../../../../src/resources/common/config.js";
import { Session } from "../../../../src/common/session.js";
import { CompositeLogger } from "../../../../src/common/logging/index.js";
import { MCPConnectionStore } from "../../../../src/common/connectionRegistry.js";
import { ExportsManager } from "../../../../src/common/exportsManager.js";
import { DeviceId } from "../../../../src/helpers/deviceId.js";
import { Keychain } from "../../../../src/common/keychain.js";
import { defaultTestConfig } from "../../../integration/helpers.js";
import { connectionErrorHandler } from "../../../../src/common/connectionErrorHandler.js";
import { defaultCreateApiClient, Telemetry } from "../../../../src/lib.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";

describe("config resource", () => {
    const logger = new CompositeLogger();
    const deviceId = DeviceId.create(logger);

    function createResource(config: UserConfig): ConfigResource {
        const connectionRegistry = new MCPConnectionStore({ userConfig: config, logger, deviceId }).view();
        const keychain = new Keychain();
        const session = vi.mocked(
            new Session({
                logger,
                exportsManager: ExportsManager.init(config, logger),
                connectionRegistry,
                keychain,
                connectionErrorHandler,
                apiClient: defaultCreateApiClient(
                    {
                        baseUrl: config.apiBaseUrl,
                        credentials: {
                            clientId: config.apiClientId,
                            clientSecret: config.apiClientSecret,
                        },
                    },
                    logger
                ),
            })
        );
        const telemetry = Telemetry.create({
            logger,
            deviceId,
            apiClient: session.apiClient,
            keychain: session.keychain,
            enabled: false,
        });
        return new ConfigResource(session, config, telemetry);
    }

    it("should not leak AWS KMS credentials in connectOptions", () => {
        const config = {
            ...defaultTestConfig,
            connectionString: "mongodb://localhost:27017",
            awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
            awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            awsSessionToken: "FwoGZXIvYXdzEXAMPLESESSIONTOKEN",
        } as unknown as UserConfig;

        const output = createResource(config).toOutput();

        expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
        expect(output).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
        expect(output).not.toContain("FwoGZXIvYXdzEXAMPLESESSIONTOKEN");
        expect(output).not.toContain("kmsProviders");
    });

    it("should summarize autoEncryption instead of emitting it verbatim", () => {
        const config = {
            ...defaultTestConfig,
            connectionString: "mongodb://localhost:27017",
            awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
            awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        } as unknown as UserConfig;

        const output = createResource(config).toOutput();
        const parsed = JSON.parse(output) as { connectOptions: { autoEncryption?: unknown } };

        expect(parsed.connectOptions.autoEncryption).toBe("set; client-side field level encryption is configured");
    });

    it("should redact keychain-registered secrets as a backstop", () => {
        const config = {
            ...defaultTestConfig,
            connectionString: "mongodb://localhost:27017",
        } as unknown as UserConfig;

        const resource = createResource(config);
        // Register a secret that would otherwise appear in the output (logPath).
        resource["session"].keychain.register(config.logPath, "url");

        const output = resource.toOutput();
        expect(output).not.toContain(config.logPath);
    });
});
