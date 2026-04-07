import { describe, it, expect, afterEach, vi } from "vitest";
import {
    StreamableHttpRunner,
    MonitoringServer,
    type CreateMonitoringServerFn,
    type MonitoringServerConstructorArgs,
} from "../../../src/transports/streamableHttp.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import type express from "express";
import type { DefaultMetrics, Metrics } from "../../../src/lib.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { MockMetrics } from "../mocks/metrics.js";
import type { CreateSessionStoreFn, ISessionStore } from "../../../src/common/sessionStore.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

describe("StreamableHttpRunner", () => {
    describe("monitoring server initialization", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let runner: StreamableHttpRunner<any> | undefined;
        let customServer: MonitoringServer | undefined;

        describe("with custom createMonitoringServer hook", () => {
            afterEach(async () => {
                await runner?.close();
                runner = undefined;
                customServer = undefined;
            });

            it("uses a custom createMonitoringServer hook to create a monitoring server", async () => {
                customServer = new MonitoringServer({
                    host: "127.0.0.1",
                    port: 3002,
                    features: ["health-check"],
                    logger: new NullLogger(),
                    metrics: new MockMetrics() as unknown as Metrics<DefaultMetrics>,
                });

                const createMonitoringServer: CreateMonitoringServerFn<DefaultMetrics> = () => customServer;

                runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                    createMonitoringServer,
                });

                expect(getMonitoringServer(runner)).toBe(customServer);

                await runner.start();

                // Verify the custom server is actually serving requests
                const address = customServer.serverAddress;
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual({ status: "ok" });
            });

            it("supports extending MonitoringServer with custom routes via hook", async () => {
                const createMonitoringServer: CreateMonitoringServerFn<DefaultMetrics> = (args) => {
                    return new CustomMonitoringServer(args);
                };

                runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                        monitoringServerFeatures: ["health-check", "metrics"],
                    },
                    createMonitoringServer,
                });

                customServer = getMonitoringServer(runner);
                expect(customServer).toBeInstanceOf(CustomMonitoringServer);

                await runner.start();

                const address = customServer!.serverAddress;

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

            it("allows createMonitoringServer to return undefined to skip creating a monitoring server", () => {
                const createMonitoringServer: CreateMonitoringServerFn<DefaultMetrics> = () => undefined;

                runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                    createMonitoringServer,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });
        });

        describe("constructor logic (no server startup)", () => {
            it("creates a MonitoringServer when monitoringServerHost and monitoringServerPort are both set", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                });

                expect(getMonitoringServer(runner)).toBeInstanceOf(MonitoringServer);
            });

            it("creates a MonitoringServer when deprecated healthCheckHost and healthCheckPort are both set", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        healthCheckHost: "127.0.0.1",
                        healthCheckPort: 0,
                    },
                });

                expect(getMonitoringServer(runner)).toBeInstanceOf(MonitoringServer);
            });

            it("does not create a MonitoringServer when only monitoringServerHost is set", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                    },
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("does not create a MonitoringServer when only monitoringServerPort is set", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerPort: 9090,
                    },
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("does not create a MonitoringServer when neither host nor port are set", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: defaultTestConfig,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("prefers monitoringServerHost/Port over deprecated healthCheckHost/Port", () => {
                const runner = new StreamableHttpRunner({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 9090,
                        healthCheckHost: "0.0.0.0",
                        healthCheckPort: 8080,
                    },
                });

                // A MonitoringServer should be created (from the non-deprecated fields)
                expect(getMonitoringServer(runner)).toBeInstanceOf(MonitoringServer);
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

        it("uses a custom createSessionStore hook to create a session store", () => {
            const mockSessionStore: ISessionStore<StreamableHTTPServerTransport> = {
                getSession: vi.fn(),
                addSession: vi.fn(),
                closeSession: vi.fn().mockResolvedValue(undefined),
                closeAllSessions: vi.fn().mockResolvedValue(undefined),
            };

            const createSessionStore: CreateSessionStoreFn<StreamableHTTPServerTransport> = () => mockSessionStore;

            runner = new StreamableHttpRunner({
                userConfig: defaultTestConfig,
                createSessionStore,
            });

            expect(getSessionStore(runner)).toBe(mockSessionStore);
        });

        it("uses default SessionStore when createSessionStore is not provided", () => {
            runner = new StreamableHttpRunner({
                userConfig: defaultTestConfig,
            });

            const sessionStore = getSessionStore(runner);
            expect(sessionStore).toBeDefined();
            expect(sessionStore).toHaveProperty("getSession");
            expect(sessionStore).toHaveProperty("addSession");
            expect(sessionStore).toHaveProperty("closeSession");
            expect(sessionStore).toHaveProperty("closeAllSessions");
        });

        it("passes correct args to createSessionStore hook", () => {
            const createSessionStore = vi.fn().mockReturnValue({
                getSession: vi.fn(),
                addSession: vi.fn(),
                closeSession: vi.fn().mockResolvedValue(undefined),
                closeAllSessions: vi.fn().mockResolvedValue(undefined),
            });

            const customConfig = {
                ...defaultTestConfig,
                idleTimeoutMs: 120_000,
                notificationTimeoutMs: 60_000,
            };

            runner = new StreamableHttpRunner({
                userConfig: customConfig,
                createSessionStore: createSessionStore as CreateSessionStoreFn<StreamableHTTPServerTransport>,
            });

            expect(createSessionStore).toHaveBeenCalledWith({
                options: {
                    idleTimeoutMS: 120_000,
                    notificationTimeoutMS: 60_000,
                },
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                logger: expect.any(Object),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                metrics: expect.any(Object),
            });
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
