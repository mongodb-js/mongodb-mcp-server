import { describe, it, expect, afterEach, vi } from "vitest";
import {
    StreamableHttpRunner,
    MonitoringServer,
    MCPHttpServer,
    type MonitoringServerOptions,
} from "@mongodb-js/mcp-http-runners";
import { defaultTestConfig } from "../integrationHelpers.js";
import type { Request, Response } from "express";
import { NoopLogger, CompositeLogger, type LoggerBase } from "@mongodb-js/mcp-core";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import type { McpServer } from "@modelcontextprotocol/server";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import type { DefaultMetricDefinitions, ServerLike } from "@mongodb-js/mcp-types";

/**
 * Minimal concrete implementation of MCPHttpServer for testing.
 */
class TestMCPHttpServer extends MCPHttpServer<ServerLike> {
    protected override createServerForRequest(): Promise<ServerLike> {
        return Promise.resolve({
            register: vi.fn().mockResolvedValue(undefined),
            mcpServer: {} as unknown as McpServer,
        });
    }
}

/**
 * Helper to create StreamableHttpRunner components from UserConfig.
 * Pass MonitoringServer directly instead of factory functions.
 */
function createStreamableHttpRunnerFromConfig(options: {
    userConfig: UserConfig;
    monitoringServer?: MonitoringServer;
    loggers?: LoggerBase[];
    metrics?: MockMetrics;
}): StreamableHttpRunner<ServerLike> {
    const { userConfig } = options;
    const logger = new CompositeLogger({ loggers: options.loggers ?? [] });
    const metrics = options.metrics ?? new MockMetrics();

    // Use provided monitoring server or create if configured
    let monitoringServer: MonitoringServer | undefined = options.monitoringServer;
    if (monitoringServer === undefined && !("monitoringServer" in options)) {
        const monitoringHost = userConfig.monitoringServerHost ?? userConfig.healthCheckHost;
        const monitoringPort = userConfig.monitoringServerPort ?? userConfig.healthCheckPort;
        if (monitoringHost !== undefined && monitoringPort !== undefined) {
            monitoringServer = new MonitoringServer({
                options: {
                    http: {
                        host: monitoringHost,
                        port: monitoringPort,
                    },
                    features: userConfig.monitoringServerFeatures,
                },
                logger,
                metrics: metrics,
            });
        }
    }

    // Create MCP HTTP server
    const mcpHttpServer = new TestMCPHttpServer({
        options: {
            http: {
                host: userConfig.httpHost,
                port: userConfig.httpPort,
                bodyLimit: userConfig.httpBodyLimit,
                headers: userConfig.httpHeaders,
                responseType: userConfig.httpResponseType,
            },
        },
        logger,
        metrics,
    });

    return new StreamableHttpRunner<ServerLike>({
        mcpHttpServer,
        monitoringServer,
        logger,
    });
}

const expectedHealthData: Record<string, unknown> = {
    status: "ok",
    version: expect.any(String) as unknown,
    uptimeSeconds: expect.any(Number) as unknown,
    timestamp: expect.any(String) as unknown,
};

describe("StreamableHttpRunner", () => {
    describe("monitoring server initialization", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let runner: StreamableHttpRunner<any> | undefined;
        let customServer: MonitoringServer | undefined;

        describe("with custom monitoringServer passed directly", () => {
            afterEach(async () => {
                await runner?.close();
                runner = undefined;
                customServer = undefined;
            });

            it("uses a custom monitoringServer passed directly", async () => {
                customServer = new MonitoringServer({
                    options: {
                        http: {
                            host: "127.0.0.1",
                            port: 3002,
                        },
                        features: ["health-check"],
                    },
                    logger: new NoopLogger(),
                    metrics: new MockMetrics(),
                });

                runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                    monitoringServer: customServer,
                });

                expect(getMonitoringServer(runner)).toBe(customServer);

                await runner.start();

                // Verify the custom server is actually serving requests
                const address = customServer.serverAddress;
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual(expectedHealthData);
            });

            it("supports extending MonitoringServer with custom routes", async () => {
                const customMonitoringServer = new CustomMonitoringServer({
                    options: {
                        http: {
                            host: "127.0.0.1",
                            port: 3002,
                        },
                        features: ["health-check", "metrics"],
                    },
                    logger: new NoopLogger(),
                    metrics: new MockMetrics(),
                });

                runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                        monitoringServerFeatures: ["health-check", "metrics"],
                    },
                    monitoringServer: customMonitoringServer,
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
                expect(await fetch(`${address}/health`).then((res) => res.json())).toEqual(expectedHealthData);
                const metricsResponse = await fetch(`${address}/metrics`);
                expect(metricsResponse.status).toBe(200);
            });

            it("allows passing undefined to skip creating a monitoring server", () => {
                runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                    monitoringServer: undefined,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });
        });

        describe("constructor logic (no server startup)", () => {
            it("creates a MonitoringServer when monitoringServerHost and monitoringServerPort are both set", () => {
                const runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                        monitoringServerPort: 3002,
                    },
                });

                expect(getMonitoringServer(runner)).toBeInstanceOf(MonitoringServer);
            });

            it("creates a MonitoringServer when deprecated healthCheckHost and healthCheckPort are both set", () => {
                const runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        healthCheckHost: "127.0.0.1",
                        healthCheckPort: 0,
                    },
                });

                expect(getMonitoringServer(runner)).toBeInstanceOf(MonitoringServer);
            });

            it("does not create a MonitoringServer when only monitoringServerHost is set", () => {
                const runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerHost: "127.0.0.1",
                    },
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("does not create a MonitoringServer when only monitoringServerPort is set", () => {
                const runner = createStreamableHttpRunnerFromConfig({
                    userConfig: {
                        ...defaultTestConfig,
                        monitoringServerPort: 9090,
                    },
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("does not create a MonitoringServer when neither host nor port are set", () => {
                const runner = createStreamableHttpRunnerFromConfig({
                    userConfig: defaultTestConfig,
                });

                expect(getMonitoringServer(runner)).toBeUndefined();
            });

            it("prefers monitoringServerHost/Port over deprecated healthCheckHost/Port", () => {
                const runner = createStreamableHttpRunnerFromConfig({
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

class CustomMonitoringServer extends MonitoringServer<DefaultMetricDefinitions> {
    constructor(args: MonitoringServerOptions<DefaultMetricDefinitions>) {
        super(args);
    }

    override async setupRoutes(): Promise<void> {
        this.app.get("/custom-route", (_req: Request, res: Response) => {
            res.json({ custom: "data" });
        });
        this.app.get("/api/status", (_req: Request, res: Response) => {
            res.json({ api: "operational" });
        });
        await super.setupRoutes();
    }
}
