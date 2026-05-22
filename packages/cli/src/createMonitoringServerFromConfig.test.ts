import { describe, expect, it, vi } from "vitest";
import { NoopLogger } from "@mongodb-js/mcp-core";
import { UserConfigSchema } from "./config/userConfig.js";

const mockMonitoringServer = vi.fn();

vi.mock("@mongodb-js/mcp-http-runners", () => ({
    MonitoringServer: class MockMonitoringServer {
        constructor(options: unknown) {
            mockMonitoringServer(options);
        }
    },
}));

import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";

describe("createMonitoringServerFromConfig", () => {
    const logger = new NoopLogger();
    const metrics = { getMetrics: vi.fn() };

    it("returns undefined when monitoring host or port is not configured", () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        expect(createMonitoringServerFromConfig({ config, logger, metrics })).toBeUndefined();
        expect(mockMonitoringServer).not.toHaveBeenCalled();
    });

    it("creates a MonitoringServer when host and port are configured", () => {
        mockMonitoringServer.mockClear();

        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
            monitoringServerHost: "127.0.0.1",
            monitoringServerPort: 9090,
            monitoringServerFeatures: ["health-check", "metrics"],
        });

        const monitoringServer = createMonitoringServerFromConfig({ config, logger, metrics });

        expect(monitoringServer).toBeDefined();
        expect(mockMonitoringServer).toHaveBeenCalledWith({
            options: {
                http: {
                    host: "127.0.0.1",
                    port: 9090,
                },
                features: ["health-check", "metrics"],
            },
            logger,
            metrics,
        });
    });
});
