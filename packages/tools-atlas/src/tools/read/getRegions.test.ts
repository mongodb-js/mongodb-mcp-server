import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { Session } from "../../../../../src/common/session.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { Keychain } from "../../../../../src/lib.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import { ATLAS_REGIONS, GetRegionsArgsShape, GetRegionsTool } from "../../../../../src/tools/atlas/read/getRegions.js";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("GetRegionsTool", () => {
    let mockSession: Partial<Session>;
    let tool: GetRegionsTool;

    function buildTool(): GetRegionsTool {
        const mockApiClient = {};

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: { allSecrets: [] } as unknown as Keychain,
        };

        const mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
            apiClientId: "test-id",
            apiClientSecret: "test-secret",
        } as unknown as UserConfig;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: GetRegionsTool.toolName,
            category: "atlas",
            operationType: GetRegionsTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new GetRegionsTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(GetRegionsArgsShape).strict().parse(tool.normalizeRawArgs(args)) as never, {} as never);

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
