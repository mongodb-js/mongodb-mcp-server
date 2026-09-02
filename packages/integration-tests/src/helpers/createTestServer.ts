import { McpServer } from "@modelcontextprotocol/server";
import { CompositeLogger, Keychain, NoopTelemetry, type AnyToolClass } from "@mongodb-js/mcp-core";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { ExportsManager, MCPConnectionStore, type DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { AllTools, CliServer, Elicitation, connectionErrorHandler, packageInfo } from "mongodb-mcp-server";
import type { UserConfig } from "mongodb-mcp-server";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { Session } from "@mongodb-js/mcp-cli";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import { vi } from "vitest";
import { createTestApiClient } from "../integrationHelpers.js";

export type CreateTestServerOptions = {
    /**
     * Tool constructors to register on the server. Defaults to `AllTools`
     * (all internal tools), matching the behavior the transport tests rely on.
     */
    tools?: AnyToolClass[];
    /** Metrics instance to use for the server (and its tools). Defaults to a fresh default registry. */
    metrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    /** Telemetry instance. Defaults to a no-op telemetry stub. */
    telemetry?: AtlasTelemetry;
    /** Device ID to attach the connection registry. Defaults to a stub. */
    deviceId?: DeviceId;
};

/**
 * Creates a fully wired `CliServer` for tests, with a mocked API client,
 * an in-memory exports manager, an Atlas Local client, and an Elicitation
 * server bound to a fresh SDK `McpServer`.
 *
 * Shared by the transport/integration test suites (streamable HTTP, metrics,
 * session config, negotiated client state, ...) to avoid duplicating the
 * wiring in each file.
 */
export async function createTestServer(config: UserConfig, options: CreateTestServerOptions = {}): Promise<CliServer> {
    const logger = new CompositeLogger({ loggers: [] });
    const keychain = Keychain.root;

    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const connectionRegistry = new MCPConnectionStore({
        options: config,
        logger,
        deviceId: options.deviceId ?? ({} as unknown as DeviceId),
    }).view();

    const apiClient = createTestApiClient({
        baseUrl: config.apiBaseUrl,
        serverMetadata: packageInfo,
        logger,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
    });

    // Mock the API client methods for tests
    vi.spyOn(apiClient, "validateAuthConfig").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "close").mockResolvedValue(undefined);

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const mcpServer = new McpServer({
        name: "test-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new Session({
        logger,
        exportsManager,
        connectionRegistry,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
        config,
    });

    const metrics = options.metrics ?? new PrometheusMetrics({ definitions: createDefaultMetrics() });

    return new CliServer({
        session,
        mcpServer,
        telemetry: options.telemetry ?? (new NoopTelemetry() as unknown as AtlasTelemetry),
        connectionErrorHandler,
        elicitation,
        metrics,
        tools: options.tools ?? AllTools,
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
    });
}
