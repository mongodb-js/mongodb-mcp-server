import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keychain } from "@mongodb-js/mcp-core";
import type { IAtlasConfig } from "../../atlasTool.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { ITelemetry, ICompositeLogger } from "@mongodb-js/mcp-types";
import { ATLAS_REGIONS, GetRegionsArgsShape, GetRegionsTool } from "./getRegions.js";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import type { AtlasToolServer } from "../../atlasTool.js";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";

describe("GetRegionsTool", () => {
    let mockSession: Partial<AtlasToolServer>;
    let tool: GetRegionsTool;

    function buildTool(): GetRegionsTool {
        const mockApiClient = {};

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as ICompositeLogger;

        mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: new Keychain(),
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
        };

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = createMockElicitation();

        const server: AtlasToolServer = {
            ...mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        } as unknown as AtlasToolServer;

        return new GetRegionsTool(server);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(GetRegionsArgsShape).strict().parse(tool.normalizeRawArgs(args)), {
            request: { config: (tool as unknown as { server: AtlasToolServer }).server.config, signal: new AbortController().signal },
        } as unknown as ToolExecutionContext);

    beforeEach(() => {
        tool = buildTool();
    });

    describe("response", () => {
        it.each(["AWS", "GCP", "AZURE"] as const)("returns the %s catalog", async (provider) => {
            const result = await exec({ provider });
            const firstRegion = ATLAS_REGIONS[provider][0]!;

            expect(result.structuredContent).toEqual({
                provider,
                regions: ATLAS_REGIONS[provider],
            });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain(firstRegion.name);
            expect(text).toContain(firstRegion.location);
        });
    });

    describe("telemetry metadata", () => {
        it("adds provider", async () => {
            const metadata = await tool["resolveTelemetryMetadata"]({ provider: "GCP" }, { result: { content: [] } });

            expect(metadata).toEqual({ provider: "GCP" });
        });
    });
});
