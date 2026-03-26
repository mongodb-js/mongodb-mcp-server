import { describe, it, expect, afterEach } from "vitest";
import { StreamableHttpRunner, MonitoringServer } from "../../../src/transports/streamableHttp.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import type express from "express";
import type { DefaultMetrics, Metrics } from "../../../src/lib.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { MockMetrics } from "../mocks/metrics.js";

describe("StreamableHttpRunner", () => {
    describe("monitoring server initialization", () => {
        let runner: StreamableHttpRunner | undefined;
        let externalServer: MonitoringServer | undefined;

        describe("with external server", () => {
            afterEach(async () => {
                await runner?.close();
                await externalServer?.stop();
                runner = undefined;
                externalServer = undefined;
            });

            it("uses an externally provided monitoringServer instead of creating one", async () => {
                externalServer = new MonitoringServer({
                    host: "127.0.0.1",
                    port: 3002,
                    features: ["health-check"],
                    logger: new NullLogger(),
                    metrics: new MockMetrics() as unknown as Metrics<DefaultMetrics>,
                });

                runner = new StreamableHttpRunner({
                    userConfig: defaultTestConfig,
                    monitoringServer: externalServer,
                });

                expect(getMonitoringServer(runner)).toBe(externalServer);

                await runner.start();

                // Verify the external server is actually serving requests
                const address = externalServer.serverAddress;
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual({ status: "ok" });
            });

            it("supports extending MonitoringServer with custom routes", async () => {
                externalServer = new CustomMonitoringServer();

                runner = new StreamableHttpRunner({
                    userConfig: defaultTestConfig,
                    monitoringServer: externalServer,
                });

                await runner.start();

                const address = externalServer.serverAddress;

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
});

// Access private field for white-box testing of constructor logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMonitoringServer(runner: StreamableHttpRunner<any>): MonitoringServer | undefined {
    return (runner as unknown as { monitoringServer: MonitoringServer | undefined }).monitoringServer;
}

class CustomMonitoringServer extends MonitoringServer {
    constructor() {
        super({
            host: "127.0.0.1",
            port: 3002,
            features: ["health-check", "metrics"],
            logger: new NullLogger(),
            metrics: new MockMetrics() as unknown as Metrics<DefaultMetrics>,
        });
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
