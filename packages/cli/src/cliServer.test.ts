import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { CompositeLogger, Elicitation, Keychain, LoggerBase } from "@mongodb-js/mcp-core";
import type { LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import type { ConnectionRegistry, ExportsManager, ConnectionErrorHandler } from "@mongodb-js/mcp-tools-mongodb";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { CliServer } from "./cliServer.js";
import { validateAppConfig } from "./createServerServices.js";
import { UserConfigSchema, type UserConfig } from "./config/userConfig.js";

const serverMetadata = {
    mcpServerName: "test-server",
    version: "1.0.0",
};

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
    return UserConfigSchema.parse({
        telemetry: "disabled",
        loggers: ["stderr"],
        // A connection string that `validateConnectionString` rejects.
        connectionString: "not-a-valid-connection-string",
        apiClientId: "test-client-id",
        apiClientSecret: "test-client-secret",
        apiBaseUrl: "https://example.com",
        ...overrides,
    });
}

class InMemoryLogger extends LoggerBase {
    public readonly messages: { level: LogLevel; payload: LogPayload }[] = [];
    public log(level: LogLevel, payload: LogPayload): void {
        this.messages.push({ level, payload });
    }
}

function makeApiClient(): { apiClient: ApiClient; validateAuthConfig: ReturnType<typeof vi.fn> } {
    const validateAuthConfig = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const apiClient = { validateAuthConfig, close } as unknown as ApiClient;
    return { apiClient, validateAuthConfig };
}

function makeServer(config: UserConfig, apiClient: ApiClient): CliServer {
    const mcpServer = new McpServer({ name: "test-server", version: "1.0.0" });
    // `register()` wraps the SDK's existing `tools/call` handler, which a tool's
    // `register` normally installs. Register one minimal tool so the handler and
    // the `tools` capability exist.
    mcpServer.registerTool("test-tool", { inputSchema: z.object({}) }, () =>
        Promise.resolve({ content: [{ type: "text", text: "ok" }] })
    );
    return new CliServer({
        config,
        logger: new CompositeLogger({ loggers: [] }),
        keychain: Keychain.root,
        connectionRegistry: {} as unknown as ConnectionRegistry,
        exportsManager: {} as unknown as ExportsManager,
        apiClient,
        connectionErrorHandler: {} as unknown as ConnectionErrorHandler,
        mcpServer,
        telemetry: {} as unknown as AtlasTelemetry,
        elicitation: new Elicitation({ server: mcpServer.server }),
        metrics: {} as unknown as IMetrics<DefaultMetricDefinitions>,
        tools: [],
        resources: [],
        serverMetadata,
    });
}

describe("CliServer config validation", () => {
    it("does not re-validate config on register (validation is startup-only)", async () => {
        const { apiClient, validateAuthConfig } = makeApiClient();
        const server = makeServer(makeConfig(), apiClient);

        // The config has an invalid connection string and Atlas credentials. If
        // `register` re-validated config, it would throw here. It must not: the
        // per-request server never re-validates app-fixed config because that is
        // done once at startup by `validateAppConfig`.
        await expect(server.register()).resolves.toBeUndefined();

        expect(validateAuthConfig).not.toHaveBeenCalled();
    });
});

describe("validateAppConfig", () => {
    it("validates the connection string at startup", async () => {
        const { apiClient } = makeApiClient();
        await expect(
            validateAppConfig({
                config: makeConfig({ connectionString: "not-a-valid-connection-string" }),
                logger: new CompositeLogger({ loggers: [] }),
                apiClient,
            })
        ).rejects.toThrow("Connection string validation failed");
    });

    it("validates Atlas API client credentials at startup", async () => {
        const { apiClient, validateAuthConfig } = makeApiClient();
        // A well-formed connection string so execution reaches the credential check.
        await validateAppConfig({
            config: makeConfig({ connectionString: "mongodb://localhost:27017" }),
            logger: new CompositeLogger({ loggers: [] }),
            apiClient,
        });

        expect(validateAuthConfig).toHaveBeenCalledTimes(1);
    });

    it("warns when apiBaseUrl is not https", async () => {
        const { apiClient } = makeApiClient();
        const logger = new InMemoryLogger();
        await validateAppConfig({
            config: makeConfig({ connectionString: "mongodb://localhost:27017", apiBaseUrl: "http://localhost:8080" }),
            logger: logger as unknown as CompositeLogger,
            apiClient,
        });

        expect(
            logger.messages.some(
                (msg) =>
                    msg.level === "warning" &&
                    String(msg.payload.message).includes(
                        "apiBaseUrl is configured to use http:, which is not secure. It is strongly recommended to use HTTPS for secure communication."
                    )
            )
        ).toBe(true);
    });
});
