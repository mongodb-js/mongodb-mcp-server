import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keychain } from "@mongodb-js/mcp-core";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import { ATLAS_REGIONS, GetRegionsArgsShape, GetRegionsTool } from "./getRegions.js";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

describe("GetRegionsTool", () => {
    let mockSession: Partial<IAtlasSession>;
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

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as IElicitation;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: GetRegionsTool.toolName,
            category: "atlas",
            operationType: GetRegionsTool.operationType,
            session: mockSession as IAtlasSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new GetRegionsTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(GetRegionsArgsShape).strict().parse(tool.normalizeRawArgs(args)), {} as never);

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
