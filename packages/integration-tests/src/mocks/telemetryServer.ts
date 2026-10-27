import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { TelemetryCommonProperties, TelemetryEvent } from "@mongodb-js/mcp-atlas-telemetry";

const UNAUTH_TELEMETRY_PATH = "/api/private/unauth/telemetry/events";
const DEFAULT_EVENT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 25;

export type ReceivedTelemetryEvent = TelemetryEvent<TelemetryCommonProperties>;

export type MockTelemetryServer = {
    baseUrl: string;
    received: ReceivedTelemetryEvent[];
    waitForEvent: (
        predicate: (event: ReceivedTelemetryEvent) => boolean,
        timeoutMs?: number
    ) => Promise<ReceivedTelemetryEvent>;
    close: () => Promise<void>;
};

/**
 * Fake telemetry ingestion endpoint. An unauthenticated `ApiClient` posts batches to
 * `/api/private/unauth/telemetry/events`; point a server at it via `MDB_MCP_API_BASE_URL`.
 */
export async function startMockTelemetryServer(): Promise<MockTelemetryServer> {
    const received: ReceivedTelemetryEvent[] = [];
    const server = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== UNAUTH_TELEMETRY_PATH) {
            res.writeHead(404).end();
            return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            received.push(...(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ReceivedTelemetryEvent[]));
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}/`,
        received,
        waitForEvent: async (predicate, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS): Promise<ReceivedTelemetryEvent> => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const match = received.find(predicate);
                if (match) {
                    return match;
                }
                await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            }
            throw new Error(
                `Timed out waiting for a telemetry event. Received ${received.length}: ${JSON.stringify(received)}`
            );
        },
        close: () =>
            new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    };
}
