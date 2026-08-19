import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger, type CompositeLogger } from "@mongodb-js/mcp-core";
import { StdioRunner } from "@mongodb-js/mcp-core";
import type * as McpCore from "@mongodb-js/mcp-core";
import type * as McpToolsMongodb from "@mongodb-js/mcp-tools-mongodb";
import { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { UserConfigSchema } from "./config/userConfig.js";

vi.mock("./createExportsManagerFromConfig.js", () => ({
    createExportsManagerFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createApiClientFromConfig.js", () => ({
    createApiClientFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createTelemetryFromConfig.js", () => ({
    createTelemetryFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createMonitoringServerFromConfig.js", () => ({
    createMonitoringServerFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@mongodb-js/mcp-tools-mongodb", async (importOriginal) => {
    const actual: typeof McpToolsMongodb = await importOriginal();
    return {
        ...actual,
        DeviceId: {
            create: vi.fn().mockReturnValue({}),
        },
        MCPConnectionManager: vi.fn().mockImplementation(function MockMCPConnectionManager() {
            return {};
        }),
    };
});

vi.mock("@mongodb-js/mcp-tools-atlas-local", () => ({
    createAtlasLocalClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@mongodb-js/mcp-core", async (importOriginal) => {
    const actual: typeof McpCore = await importOriginal();
    return {
        ...actual,
        McpServer: class MockMcpServer {
            server = {};
        },
        Elicitation: class MockElicitation {},
    };
});

vi.mock("./cliSession.js", () => ({
    Session: class MockSession {
        close(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock("./cliServer.js", () => ({
    CliServer: class MockCliServer {},
}));

import {
    createServerFromConfig,
    createRunnerFromConfig,
    createHttpTransportRunnerFromConfig,
} from "./createRunnerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";
import { createMonitoringServerFromConfig } from "./createMonitoringServerFromConfig.js";

describe("createServerFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should wire config-based factories when creating services", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        const services = await createServerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(services.config).toBe(config);
        expect(createExportsManagerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createApiClientFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createTelemetryFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createMonitoringServerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
    });
});

describe("createRunnerFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return a StdioRunner for the stdio transport", async () => {
        const config = UserConfigSchema.parse({
            transport: "stdio",
            telemetry: "disabled",
        });

        const runner = await createRunnerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(runner).toBeInstanceOf(StdioRunner);
    });

    it("should return a StreamableHttpRunner for the http transport", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const runner = await createRunnerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        expect(runner).toBeInstanceOf(StreamableHttpRunner);
    });
});

describe("createHttpTransportRunnerFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger() as unknown as CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return a StreamableHttpRunner wired for http", async () => {
        const config = UserConfigSchema.parse({
            transport: "http",
            telemetry: "disabled",
        });

        const { server, metrics, monitoringServer } = await createServerFromConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
            logger,
        });

        const runner = createHttpTransportRunnerFromConfig({
            config,
            server,
            logger,
            metrics,
            monitoringServer,
        });

        expect(runner).toBeInstanceOf(StreamableHttpRunner);
    });
});
