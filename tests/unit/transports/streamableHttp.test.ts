import { describe, it, expect } from "vitest";
import { StreamableHttpRunner, MonitoringServer } from "../../../src/transports/streamableHttp.js";
import { defaultTestConfig } from "../../integration/helpers.js";
import type express from "express";
import type { DefaultMetrics, Metrics } from "../../../src/lib.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { MockMetrics } from "../mocks/metrics.js";

describe("StreamableHttpRunner", () => {
    describe("monitoring server initialization", () => {
        it("uses an externally provided monitoringServer instead of creating one", async () => {
            const externalServer = new MonitoringServer({
                host: "127.0.0.1",
                port: 3001,
                features: ["health-check"],
                logger: new NullLogger(),
                metrics: new MockMetrics() as unknown as Metrics<DefaultMetrics>,
            });

            const runner = new StreamableHttpRunner({
                userConfig: defaultTestConfig,
                monitoringServer: externalServer,
            });

            expect(getMonitoringServer(runner)).toBe(externalServer);

            await runner.start();

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify the external server is actually serving requests
            expect(await fetch("http://127.0.0.1:3001/health").then((res) => res.json())).toEqual({ status: "ok" });
        });

        it("supports extending MonitoringServer with custom routes", async () => {
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
            const customServer = new CustomMonitoringServer();

            const runner = new StreamableHttpRunner({
                userConfig: defaultTestConfig,
                monitoringServer: customServer,
            });

            await runner.start();

            // Verify custom routes work
            expect(await fetch("http://localhost:3001/custom-route").then((res) => res.json())).toEqual({
                custom: "data",
            });
            expect(await fetch("http://localhost:3001/api/status").then((res) => res.json())).toEqual({
                api: "operational",
            });

            // Verify default routes from parent class still work
            expect(await fetch("http://localhost:3001/health").then((res) => res.json())).toEqual({ status: "ok" });
            const metricsResponse = await fetch("http://localhost:3001/metrics");
            expect(metricsResponse.status).toBe(200);
        });

        it("creates a MonitoringServer when monitoringServerHost and monitoringServerPort are both set", () => {
            const runner = new StreamableHttpRunner({
                userConfig: {
                    ...defaultTestConfig,
                    monitoringServerHost: "127.0.0.1",
                    monitoringServerPort: 0,
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

// Access private field for white-box testing of constructor logic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMonitoringServer(runner: StreamableHttpRunner<any>): MonitoringServer | undefined {
    return (runner as unknown as { monitoringServer: MonitoringServer | undefined }).monitoringServer;
}
