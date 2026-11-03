import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { TelemetryCommonProperties, TelemetryEvent } from "@mongodb-js/mcp-atlas-telemetry";

const UNAUTH_TELEMETRY_PATH = "/api/private/unauth/telemetry/events";
const DEFAULT_EVENT_TIMEOUT_MS = 15_000;

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

type Waiter = {
    predicate: (event: ReceivedTelemetryEvent) => boolean;
    resolve: (event: ReceivedTelemetryEvent) => void;
    timer: ReturnType<typeof setTimeout>;
};

/**
 * Fake telemetry ingestion endpoint. An unauthenticated `ApiClient` posts batches to
 * `/api/private/unauth/telemetry/events`; point a server at it via `MDB_MCP_API_BASE_URL`.
 */
export async function startMockTelemetryServer(): Promise<MockTelemetryServer> {
    const received: ReceivedTelemetryEvent[] = [];
    const waiters = new Set<Waiter>();

    const settleWaiters = (): void => {
        for (const waiter of waiters) {
            const match = received.find(waiter.predicate);
            if (match) {
                clearTimeout(waiter.timer);
                waiters.delete(waiter);
                waiter.resolve(match);
            }
        }
    };

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
            settleWaiters();
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}/`,
        received,
        waitForEvent: (predicate, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS): Promise<ReceivedTelemetryEvent> => {
            const existing = received.find(predicate);
            if (existing) {
                return Promise.resolve(existing);
            }
            return new Promise((resolve, reject) => {
                const waiter: Waiter = {
                    predicate,
                    resolve,
                    timer: setTimeout(() => {
                        waiters.delete(waiter);
                        reject(
                            new Error(
                                `Timed out waiting for a telemetry event. Received ${received.length}: ${JSON.stringify(received)}`
                            )
                        );
                    }, timeoutMs),
                };
                waiters.add(waiter);
            });
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                for (const waiter of waiters) {
                    clearTimeout(waiter.timer);
                }
                waiters.clear();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}
