import { AtlasTelemetry, type TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { CompositeLogger, Keychain, ToolBase } from "@mongodb-js/mcp-core";
import type { DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";
import type {
    CallToolResult,
    IDeviceId,
    OperationType,
    ToolCategory,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestApiClient } from "./integrationHelpers.js";
import { useMockTelemetry } from "./helpers/useMockTelemetry.js";
import { type TestServer } from "./mocks/tools.js";

const SERVER_METADATA = { mcpServerName: "telemetry-delivery-test", version: "1.0.0" };
const EVENT_TIMEOUT_MS = 10_000;

function createTelemetry(baseUrl: string): AtlasTelemetry {
    const logger = new CompositeLogger({ loggers: [] });
    const deviceId: IDeviceId = { get: () => Promise.resolve("telemetry-e2e-device"), close: () => {} };
    return AtlasTelemetry.create({
        logger,
        deviceId,
        apiClient: createTestApiClient({ baseUrl, serverMetadata: SERVER_METADATA, logger }),
        keychain: new Keychain(),
        enabled: true,
        serverMetadata: SERVER_METADATA,
    });
}

function createToolServer(telemetry: AtlasTelemetry): TestServer {
    return {
        config: { confirmationRequiredTools: [], previewFeatures: [], disabledTools: [] },
        logger: new CompositeLogger({ loggers: [] }),
        keychain: new Keychain(),
        telemetry,
        elicitation: { supportsElicitation: () => false },
        metrics: new MockMetrics(),
        uiRegistry: new UIRegistry(),
        mcpServer: {
            registerTool: (): { enabled: boolean; disable: () => void; enable: () => void } => ({
                enabled: true,
                disable: (): void => {},
                enable: (): void => {},
            }),
        },
        tools: [],
        isToolCategoryAvailable: () => true,
    } as unknown as TestServer;
}

// Gates the deferred tool's telemetry metadata so a test can close the pipeline
// while the fire-and-forget emit is still resolving.
let releaseMetadata: () => void = () => {};
let metadataGate: Promise<void> = Promise.resolve();

class DeferredMetadataTool extends ToolBase<TestServer, DefaultPrometheusMetricDefinitions> {
    static toolName = "deferred-metadata-tool";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "read";
    public description = "Tool whose telemetry metadata resolves on demand";

    public argsShape(): Record<string, never> {
        return {};
    }

    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
    }

    protected async resolveTelemetryMetadata(): Promise<TelemetryToolMetadata> {
        await metadataGate;
        return {};
    }
}

describe("tool telemetry delivery", () => {
    const telemetryServer = useMockTelemetry();

    beforeEach(() => {
        metadataGate = new Promise<void>((resolve) => {
            releaseMetadata = resolve;
        });
    });

    afterEach(() => {
        releaseMetadata();
    });

    /**
     * Regression: a request-scoped pipeline is closed on teardown while a tool's
     * async metadata resolution is still in flight, so the event lands after
     * close() already flushed. It must still reach the telemetry endpoint.
     */
    it("delivers a tool event whose metadata resolves after the pipeline closed", async () => {
        const telemetry = createTelemetry(telemetryServer.baseUrl);
        try {
            await telemetry.setupPromise;
            const transportRequest: TransportRequestContext = { headers: {}, mcp_client_protocol: "2026-07-28" };
            const tool = new DeferredMetadataTool({ server: createToolServer(telemetry), transportRequest });

            await tool.invoke({}, { request: { signal: AbortSignal.timeout(EVENT_TIMEOUT_MS) } });
            await telemetry.close();
            releaseMetadata();

            const event = await telemetryServer.waitForEvent(
                (e) => e.properties.command === "deferred-metadata-tool",
                EVENT_TIMEOUT_MS
            );
            expect(event.properties).toMatchObject({
                component: "tool",
                result: "success",
                mcp_client_protocol: "2026-07-28",
            });
        } finally {
            await telemetry.close().catch(() => undefined);
        }
    });
});
