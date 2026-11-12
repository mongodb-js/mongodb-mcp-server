import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { connect, defaultTestConfig } from "../../../integrationHelpers.js";
import { describeWithMongoDB, type MongoDBIntegrationTestCase } from "../../../mongodbHelpers.js";
import { createStreamableHttpTestRunner } from "../../../helpers/streamableHttpTestRunner.js";
import { createTestServer } from "../../../helpers/createTestServer.js";
import { freshInsertDocuments } from "./helpers.js";

const COLLECTION = "cancellation";

/**
 * A pipeline that can't use an index and does all of its work before the first
 * batch is returned: every document is joined against the whole collection
 * through `$expr` on converted values, then sorted.
 */
const SLOW_PIPELINE = [
    {
        $lookup: {
            from: COLLECTION,
            let: { value: "$value" },
            pipeline: [{ $match: { $expr: { $eq: [{ $toString: "$value" }, { $toString: "$$value" }] } } }],
            as: "matches",
        },
    },
    { $sort: { "matches.value": -1 } },
];

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Counts the aggregations against the test collection currently running on the server. */
async function runningAggregations(integration: MongoDBIntegrationTestCase): Promise<number> {
    const ops = await integration
        .mongoClient()
        .db("admin")
        .aggregate([
            { $currentOp: { allUsers: true } },
            { $match: { ns: `${integration.randomDbName()}.${COLLECTION}`, "command.aggregate": COLLECTION } },
        ])
        .toArray();
    return ops.length;
}

async function waitForRunningAggregations(
    integration: MongoDBIntegrationTestCase,
    predicate: (count: number) => boolean,
    timeoutMs: number
): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let count = await runningAggregations(integration);
    while (!predicate(count) && Date.now() < deadline) {
        await sleep(100);
        count = await runningAggregations(integration);
    }
    return count;
}

/**
 * Starts a slow aggregate through `startCall`, waits until it is executing on
 * the server, cancels it through `cancel`, then waits (up to 5s, far less than
 * the pipeline needs to finish on its own) for the server-side operation to go
 * away. Returns how many matching operations were running before and after.
 */
async function cancelSlowAggregate({
    integration,
    startCall,
    cancel,
}: {
    integration: MongoDBIntegrationTestCase;
    startCall: () => Promise<unknown>;
    cancel: () => void;
}): Promise<{ runningBefore: number; runningAfter: number }> {
    const pending = startCall().catch(() => undefined);
    const runningBefore = await waitForRunningAggregations(integration, (count) => count > 0, 10_000);

    cancel();

    const runningAfter = await waitForRunningAggregations(integration, (count) => count === 0, 5_000);
    await pending;
    return { runningBefore, runningAfter };
}

describeWithMongoDB({
    name: "aggregate cancellation stops the operation on the server",
    fn: (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection(COLLECTION),
                count: 8000,
            });
        });

        it("kills the aggregation when the client sends notifications/cancelled", async () => {
            const connectionId = await integration.connectMcpClient();
            const controller = new AbortController();

            const { runningBefore, runningAfter } = await cancelSlowAggregate({
                integration,
                startCall: () =>
                    integration.mcpClient().callTool(
                        {
                            name: "aggregate",
                            arguments: {
                                connectionId,
                                database: integration.randomDbName(),
                                collection: COLLECTION,
                                pipeline: SLOW_PIPELINE,
                            },
                        },
                        { signal: controller.signal }
                    ),
                cancel: () => controller.abort(),
            });

            expect(runningBefore).toBeGreaterThan(0);
            expect(runningAfter).toBe(0);
        });

        describe("over a 2025-era HTTP session", () => {
            registerHttpSessionTests(integration);
        });
    },
    config: {
        getUserConfig: () => ({ ...defaultTestConfig, indexCheck: false }),
    },
});

function registerHttpSessionTests(integration: MongoDBIntegrationTestCase): void {
    let components: ReturnType<typeof createStreamableHttpTestRunner> | undefined;
    let client: Client | undefined;

    beforeEach(async () => {
        components = createStreamableHttpTestRunner(
            { ...defaultTestConfig, httpPort: 0, indexCheck: false },
            {
                createServer: (config) =>
                    createTestServer(config, {
                        deviceId: { get: () => Promise.resolve("test-device-id") } as unknown as DeviceId,
                    }),
            }
        );
        await components.runner.start();
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await components?.runner.close();
        components = undefined;
    });

    it("kills the aggregation when a 2025-era HTTP client disconnects mid-call", async () => {
        if (!components) {
            throw new Error("HTTP runner not started");
        }
        const serverUrl = `${components.getServerAddress()}/mcp`;
        const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
        client = new Client({ name: "disconnecting-client", version: "0.0.0" });
        await client.connect(transport);
        const connectionId = await connect(client, integration.connectionString());

        // A raw POST on the client's session, so the test can drop the
        // connection without sending notifications/cancelled first.
        const controller = new AbortController();
        const { runningBefore, runningAfter } = await cancelSlowAggregate({
            integration,
            startCall: async () => {
                const response = await fetch(serverUrl, {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "content-type": "application/json",
                        accept: "application/json, text/event-stream",
                        "mcp-session-id": transport.sessionId ?? "",
                        "mcp-protocol-version": transport.protocolVersion ?? "",
                    },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "tools/call",
                        params: {
                            name: "aggregate",
                            arguments: {
                                connectionId,
                                database: integration.randomDbName(),
                                collection: COLLECTION,
                                pipeline: SLOW_PIPELINE,
                            },
                        },
                    }),
                });
                return response.text();
            },
            cancel: () => controller.abort(),
        });

        expect(runningBefore).toBeGreaterThan(0);
        expect(runningAfter).toBe(0);
    });
}
