import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
    AtlasTelemetry,
    type TelemetryCommonProperties,
    type TelemetryEvent,
    type TelemetryToolMetadata,
} from "@mongodb-js/mcp-atlas-telemetry";
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
import { TestTool, type TestServer } from "./mocks/tools.js";

const SERVER_METADATA = { mcpServerName: "telemetry-delivery-test", version: "1.0.0" };
const UNAUTH_TELEMETRY_PATH = "/api/private/unauth/telemetry/events";
const EVENT_TIMEOUT_MS = 10_000;

type ReceivedEvent = TelemetryEvent<TelemetryCommonProperties>;

/**
 * Fake telemetry ingestion endpoint. An unauthenticated `ApiClient` posts event
 * batches to `<baseUrl>/api/private/unauth/telemetry/events`, so the server only
 * has to accept that path and record the parsed batch.
 */
async function startFakeTelemetryServer(): Promise<{
    baseUrl: string;
    received: ReceivedEvent[];
    waitForEvent: (predicate: (event: ReceivedEvent) => boolean) => Promise<ReceivedEvent>;
    close: () => Promise<void>;
}> {
    const received: ReceivedEvent[] = [];
    const server = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== UNAUTH_TELEMETRY_PATH) {
            res.writeHead(404).end();
            return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            received.push(...(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ReceivedEvent[]));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}/`,
        received,
        waitForEvent: async (predicate): Promise<ReceivedEvent> => {
            const deadline = Date.now() + EVENT_TIMEOUT_MS;
            while (Date.now() < deadline) {
                const match = received.find(predicate);
                if (match) {
                    return match;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error(
                `Timed out waiting for a telemetry event. Received ${received.length}: ${JSON.stringify(received)}`
            );
        },
        close: () =>
            new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
}

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
    beforeEach(() => {
        metadataGate = new Promise<void>((resolve) => {
            releaseMetadata = resolve;
        });
    });

    afterEach(() => {
        releaseMetadata();
    });

    it("delivers a tool event to the telemetry endpoint", async () => {
        const fake = await startFakeTelemetryServer();
        const telemetry = createTelemetry(fake.baseUrl);
        try {
            await telemetry.setupPromise;
            const tool = new TestTool({ server: createToolServer(telemetry) });

            await tool.invoke({ param1: "x" }, { request: { signal: AbortSignal.timeout(EVENT_TIMEOUT_MS) } });
            await telemetry.close();

            const event = await fake.waitForEvent((e) => e.properties.command === "test-tool");
            expect(event.properties).toMatchObject({
                component: "tool",
                result: "success",
                mcp_server_name: SERVER_METADATA.mcpServerName,
            });
        } finally {
            await telemetry.close().catch(() => undefined);
            await fake.close();
        }
    });

    /**
     * Regression: a request-scoped pipeline is closed on teardown while a tool's
     * async metadata resolution is still in flight, so the event lands after
     * close() already flushed. It must still reach the telemetry endpoint.
     */
    it("delivers a tool event whose metadata resolves after the pipeline closed", async () => {
        const fake = await startFakeTelemetryServer();
        const telemetry = createTelemetry(fake.baseUrl);
        try {
            await telemetry.setupPromise;
            const transportRequest: TransportRequestContext = { headers: {}, mcp_client_protocol: "2026-07-28" };
            const tool = new DeferredMetadataTool({ server: createToolServer(telemetry), transportRequest });

            await tool.invoke({}, { request: { signal: AbortSignal.timeout(EVENT_TIMEOUT_MS) } });
            await telemetry.close();
            releaseMetadata();

            const event = await fake.waitForEvent((e) => e.properties.command === "deferred-metadata-tool");
            expect(event.properties).toMatchObject({
                component: "tool",
                result: "success",
                mcp_client_protocol: "2026-07-28",
            });
        } finally {
            await telemetry.close().catch(() => undefined);
            await fake.close();
        }
    });
});
