import { describe, it, expect, afterEach } from "vitest";
import { MonitoringServer } from "../../../src/transports/streamableHttp.js";
import { NullLogger } from "../../../src/common/logging/index.js";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";

describe("MonitoringServer", () => {
    let server: MonitoringServer | undefined;
    const logger = new NullLogger();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metrics = new PrometheusMetrics<any>({ definitions: createDefaultMetrics() });

    afterEach(async () => {
        await server?.stop();
        server = undefined;
    });

    describe("start", () => {
        it("starts the server and makes it reachable", async () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            await server.start();

            const address = server.serverAddress;
            expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

            // Verify the server is actually running by making a request
            const response = await fetch(`${address}/health`);
            expect(response.status).toBe(200);
        });

        it("exposes health endpoint when health-check feature is enabled", async () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            await server.start();

            const response = await fetch(`${server.serverAddress}/health`);
            expect(response.status).toBe(200);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const body = await response.json();
            expect(body).toEqual({ status: "ok" });
        });

        it("does not expose health endpoint when health-check feature is disabled", async () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["metrics"], // Only metrics, no health-check
                logger,
                metrics,
            });

            await server.start();

            const response = await fetch(`${server.serverAddress}/health`);
            expect(response.status).toBe(404);
        });

        it("exposes metrics endpoint when metrics feature is enabled", async () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["metrics"],
                logger,
                metrics,
            });

            await server.start();

            const response = await fetch(`${server.serverAddress}/metrics`);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toMatch(/^text\/plain/);

            const body = await response.text();
            // Should contain Prometheus metrics from the default metrics
            expect(body).toContain("# HELP");
        });

        it("does not expose metrics endpoint when metrics feature is disabled", async () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"], // Only health-check, no metrics
                logger,
                metrics,
            });

            await server.start();

            const response = await fetch(`${server.serverAddress}/metrics`);
            expect(response.status).toBe(404);
        });
    });

    describe("stop", () => {
        it("stops the server gracefully", async () => {
            const localServer = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            await localServer.start();
            const address = localServer.serverAddress;

            // Verify server is running
            const responseBefore = await fetch(`${address}/health`);
            expect(responseBefore.status).toBe(200);

            // Stop the server
            await localServer.stop();

            // After stopping, the server should not respond
            await expect(fetch(`${address}/health`)).rejects.toThrow();
        });

        it("calling stop multiple times throws on second call", async () => {
            const localServer = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            await localServer.start();
            await localServer.stop();

            // Second call throws because Express server.close() throws when already closed
            await expect(localServer.stop()).rejects.toThrow("Server is not running");
        });

        it("is safe to call stop when server was never started", async () => {
            const localServer = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            // Should not throw
            await expect(localServer.stop()).resolves.not.toThrow();
        });
    });

    describe("serverAddress", () => {
        it("throws when server is not started", () => {
            server = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger,
                metrics,
            });

            expect(() => server!.serverAddress).toThrow("Server is not started yet");
        });
    });
});
