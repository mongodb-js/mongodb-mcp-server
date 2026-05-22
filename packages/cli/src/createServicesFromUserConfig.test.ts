import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger, type CompositeLogger } from "@mongodb-js/mcp-core";
import type * as McpCore from "@mongodb-js/mcp-core";
import type * as McpToolsMongodb from "@mongodb-js/mcp-tools-mongodb";
import { UserConfigSchema } from "./config/userConfig.js";

vi.mock("./createLoggerFromConfig.js", () => ({
    createLoggerFromConfig: vi.fn().mockResolvedValue(new NoopLogger() as CompositeLogger),
}));

vi.mock("./createExportsManagerFromConfig.js", () => ({
    createExportsManagerFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createApiClientFromConfig.js", () => ({
    createApiClientFromConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("./createTelemetryFromConfig.js", () => ({
    createTelemetryFromConfig: vi.fn().mockReturnValue({}),
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
    CliSession: class MockCliSession {},
}));

vi.mock("./cliServer.js", () => ({
    CliServer: class MockCliServer {},
}));

import { createServicesFromUserConfig } from "./createServicesFromUserConfig.js";
import { createLoggerFromConfig } from "./createLoggerFromConfig.js";
import { createExportsManagerFromConfig } from "./createExportsManagerFromConfig.js";
import { createApiClientFromConfig } from "./createApiClientFromConfig.js";
import { createTelemetryFromConfig } from "./createTelemetryFromConfig.js";

describe("createServicesFromUserConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should wire config-based factories when creating services", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        await createServicesFromUserConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
        });

        expect(createLoggerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createExportsManagerFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config }));
        expect(createApiClientFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
        expect(createTelemetryFromConfig).toHaveBeenCalledWith(expect.objectContaining({ config, serverMetadata }));
    });
});
