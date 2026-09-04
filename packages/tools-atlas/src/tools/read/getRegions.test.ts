import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keychain } from "@mongodb-js/mcp-core";
import type { IAtlasConfig } from "../../atlasTool.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { ITelemetry, ICompositeLogger, CallToolResult } from "@mongodb-js/mcp-types";
import { ATLAS_REGIONS, GetRegionsArgsShape, GetRegionsTool } from "./getRegions.js";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import type { AtlasToolServer } from "../../atlasTool.js";

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

        return new GetRegionsTool({ server });
    }

    // The invoke() result is narrowed to CallToolResult: the tool under test
    // never returns input_required.
    const exec = async (args: Record<string, unknown>): Promise<CallToolResult> =>
        (await tool["invoke"](z.object(GetRegionsArgsShape).strict().parse(tool.normalizeRawArgs(args)), {
            request: {
                signal: new AbortController().signal,
            },
        })) as CallToolResult;

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
