import { describe, expect, it } from "vitest";
import { ConfigResource } from "./config.js";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { ApiClient, userAgentFromServerMetadata } from "@mongodb-js/mcp-atlas-api-client";
import { UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";
import { DeviceId, MCPConnectionStore } from "@mongodb-js/mcp-tools-mongodb";

const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
    maxActiveConnections: 10,
};

const testServerMetadata = {
    mcpServerName: "test-server",
    version: "0.0.0",
} as const;

describe("config resource", () => {
    const logger = new CompositeLogger();
    const deviceId = DeviceId.create(logger);

    function createResource(config: UserConfig): ConfigResource {
        const connectionRegistry = new MCPConnectionStore({ options: config, logger, deviceId }).view();
        const keychain = new Keychain();
        const apiClient = new ApiClient({
            options: {
                baseUrl: config.apiBaseUrl,
                userAgent: userAgentFromServerMetadata(testServerMetadata),
                httpClient: {
                    fetch: globalThis.fetch.bind(globalThis),
                    Request: globalThis.Request,
                },
            },
            logger,
        });
        const telemetry = AtlasTelemetry.create({
            logger,
            deviceId,
            apiClient,
            keychain,
            enabled: false,
            serverMetadata: testServerMetadata,
        });
        return new ConfigResource(
            {
                config,
                logger,
                keychain,
                connectionRegistry,
            },
            telemetry
        );
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
        resource["keychain"].register(config.logPath, "url");

        const output = resource.toOutput();
        expect(output).not.toContain(config.logPath);
    });
});
