import { describe, it, expect, afterEach, vi } from "vitest";
import {
    StreamableHttpRunner,
    MonitoringServer,
    createDefaultSessionStore,
    type ISessionStore,
} from "@mongodb-mcp/transport";
import { defaultTestConfig } from "../../integration/helpers.js";
import type express from "express";
import type { DefaultMetrics, Metrics } from "../../../src/lib.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { MockMetrics } from "../mocks/metrics.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";

describe("StreamableHttpRunner", () => {
    const logger = new NullLogger();
    const deviceId = DeviceId.create(logger);
    const metrics = new MockMetrics() as unknown as Metrics<DefaultMetrics>;

    const createBaseRunnerConfig = (): {
        userConfig: typeof defaultTestConfig;
        logger: typeof logger;
        deviceId: typeof deviceId;
        metrics: typeof metrics;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    } => ({
        userConfig: defaultTestConfig,
        logger,
        deviceId,
        metrics,
        sessionStore: createDefaultSessionStore<StreamableHTTPServerTransport>({
            idleTimeoutMs: defaultTestConfig.idleTimeoutMs,
            notificationTimeoutMs: defaultTestConfig.notificationTimeoutMs,
            logger,
            metrics,
        }),
    });

    describe("monitoring server initialization", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let runner: StreamableHttpRunner<any> | undefined;
        let customServer: MonitoringServer | undefined;

        describe("with injected monitoringServer", () => {
            afterEach(async () => {
                await runner?.close();
                runner = undefined;
                customServer = undefined;
            });

            it("uses an injected monitoring server instance", async () => {
                customServer = new MonitoringServer({
                    host: "127.0.0.1",
                    port: 3002,
                    features: ["health-check"],
                    logger,
                    metrics,
                });

                runner = new StreamableHttpRunner({
                    ...createBaseRunnerConfig(),
                    monitoringServer: customServer,
                });

                expect(getMonitoringServer(runner)).toBe(customServer);

                await runner.start();

                // Verify the custom server is actually serving requests
                const address = customServer.serverAddress;
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual({ status: "ok" });
            });

            it("supports extending MonitoringServer with custom routes via injection", async () => {
                customServer = new CustomMonitoringServer({
                    host: "127.0.0.1",
                    port: 3002,
                    features: ["health-check", "metrics"],
                    logger,
                    metrics,
                });

                runner = new StreamableHttpRunner({
                    ...createBaseRunnerConfig(),
                    monitoringServer: customServer,
                });

                expect(getMonitoringServer(runner)).toBeInstanceOf(CustomMonitoringServer);

                await runner.start();

                const address = customServer.serverAddress;

                // Verify custom routes work
                expect(await fetch(`${address}/custom-route`).then((res) => res.json())).toEqual({
                    custom: "data",
                });
                expect(await fetch(`${address}/api/status`).then((res) => res.json())).toEqual({
                    api: "operational",
                });

                // Verify default routes from parent class still work
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual({ status: "ok" });
                const metricsResponse = await fetch(`${address}/metrics`);
                expect(metricsResponse.status).toBe(200);
            });

            it("allows undefined to skip creating a monitoring server", () => {
                runner = new StreamableHttpRunner({
                    ...createBaseRunnerConfig(),
                    monitoringServer: undefined,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });
        });

        describe("constructor logic (no server startup)", () => {
            it("stores an injected MonitoringServer", () => {
                const monitoringServer = new MonitoringServer({
                    host: "127.0.0.1",
                    port: 3002,
                    features: ["health-check"],
                    logger,
                    metrics,
                });

                const runner = new StreamableHttpRunner({
                    ...createBaseRunnerConfig(),
                    monitoringServer,
                });

                expect(getMonitoringServer(runner)).toBe(monitoringServer);
            });

            it("does not create a MonitoringServer when undefined is passed", () => {
                const runner = new StreamableHttpRunner({
                    ...createBaseRunnerConfig(),
                    monitoringServer: undefined,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });
        });
    });

    describe("session store initialization", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let runner: StreamableHttpRunner<any> | undefined;

        afterEach(async () => {
            await runner?.close();
            runner = undefined;
        });

        it("uses an injected session store instance", () => {
            const mockSessionStore: ISessionStore<StreamableHTTPServerTransport> = {
                getSession: vi.fn(),
                setSession: vi.fn(),
                closeSession: vi.fn().mockResolvedValue(undefined),
                closeAllSessions: vi.fn().mockResolvedValue(undefined),
            };

            runner = new StreamableHttpRunner({
                ...createBaseRunnerConfig(),
                sessionStore: mockSessionStore,
            });

            expect(getSessionStore(runner)).toBe(mockSessionStore);
        });

        it("uses the injected session store (default one)", () => {
            const sessionStore = createDefaultSessionStore<StreamableHTTPServerTransport>({
                idleTimeoutMs: defaultTestConfig.idleTimeoutMs,
                notificationTimeoutMs: defaultTestConfig.notificationTimeoutMs,
                logger,
                metrics,
            });

            runner = new StreamableHttpRunner({
                ...createBaseRunnerConfig(),
                sessionStore,
            });

            expect(getSessionStore(runner)).toBe(sessionStore);
            expect(sessionStore).toHaveProperty("getSession");
            expect(sessionStore).toHaveProperty("setSession");
            expect(sessionStore).toHaveProperty("closeSession");
            expect(sessionStore).toHaveProperty("closeAllSessions");
        });
    });
});

// Access private field for white-box testing of constructor logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMonitoringServer(runner: StreamableHttpRunner<any>): MonitoringServer | undefined {
    return (runner as unknown as { monitoringServer: MonitoringServer | undefined }).monitoringServer;
}

// Access private field for white-box testing of constructor logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSessionStore(runner: StreamableHttpRunner<any>): ISessionStore<StreamableHTTPServerTransport> | undefined {
    return (runner as unknown as { sessionStore: ISessionStore<StreamableHTTPServerTransport> | undefined })
        .sessionStore;
}

class CustomMonitoringServer extends MonitoringServer {
    constructor(args: MonitoringServerConstructorArgs<DefaultMetrics>) {
        super(args);
    }

    override async setupRoutes(): Promise<void> {
        this.app.get("/custom-route", (_req: express.Request, res: express.Response) => {
            res.json({ custom: "data" });
        });
        this.app.get("/api/status", (_req: express.Request, res: express.Response) => {
            res.json({ api: "operational" });
        });
        await super.setupRoutes();
    }
}
