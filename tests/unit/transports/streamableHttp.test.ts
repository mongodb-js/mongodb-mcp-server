import { describe, it, expect } from "vitest";
import { StreamableHttpRunner, MonitoringServer } from "../../../src/transports/streamableHttp.js";
import { defaultTestConfig } from "../../integration/helpers.js";

describe("StreamableHttpRunner", () => {
    describe("monitoring server initialization", () => {
        it("uses an externally provided monitoringServer instead of creating one", () => {
            const externalServer = new MonitoringServer({
                host: "127.0.0.1",
                port: 0,
                features: ["health-check"],
                logger: undefined as never,
                metrics: undefined as never,
            });

            const runner = new StreamableHttpRunner({
                userConfig: defaultTestConfig,
                monitoringServer: externalServer,
            });

            expect(getMonitoringServer(runner)).toBe(externalServer);
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
