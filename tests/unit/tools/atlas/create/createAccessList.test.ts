import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateAccessListTool } from "../../../../../src/tools/atlas/create/createAccessList.js";
import { DEFAULT_ACCESS_LIST_COMMENT } from "../../../../../src/common/atlas/accessListUtils.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp";

const projectId = "507f1f77bcf86cd799439011";
const currentIpAddress = "203.0.113.10";

describe("CreateAccessListTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: CreateAccessListTool;

    beforeEach(() => {
        mockApiClient = {
            createAccessListEntry: vi.fn().mockResolvedValue({}),
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: currentIpAddress }),
        };
        Object.assign(mockApiClient, { supportsCurrentIpLookup: true });

        tool = makeTool(mockApiClient);
    });

    function makeTool(apiClient: unknown): CreateAccessListTool {
        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: apiClient as ApiClient,
        } as unknown as Session;

        const params: ToolConstructorParams = {
            name: CreateAccessListTool.toolName,
            category: "atlas",
            operationType: CreateAccessListTool.operationType,
            session: mockSession,
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as UserConfig,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as Telemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new CreateAccessListTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("creates access list entries for IPs and CIDR blocks", async () => {
        const result = await exec({
            projectId,
            ipAddresses: ["192.168.1.1"],
            cidrBlocks: ["10.0.0.0/24"],
        });

        expect((result.content[0] as { text: string }).text).toContain(
            `IP/CIDR ranges added to access list for project ${projectId}`
        );
        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith(
            {
                params: { path: { groupId: projectId } },
                body: [
                    { groupId: projectId, ipAddress: "192.168.1.1", comment: DEFAULT_ACCESS_LIST_COMMENT },
                    { groupId: projectId, cidrBlock: "10.0.0.0/24", comment: DEFAULT_ACCESS_LIST_COMMENT },
                ],
            },
            expect.anything()
        );
        expect(result.structuredContent).toEqual({ projectId });
    });

    it("includes current IP when currentIpAddress is true", async () => {
        const result = await exec({
            projectId,
            currentIpAddress: true,
        });

        expect(mockApiClient.getIpInfo).toHaveBeenCalled();
        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith(
            {
                params: { path: { groupId: projectId } },
                body: [{ groupId: projectId, ipAddress: currentIpAddress, comment: DEFAULT_ACCESS_LIST_COMMENT }],
            },
            expect.anything()
        );
        expect(result.structuredContent).toEqual({ projectId });
    });

    it("throws when no inputs are provided", async () => {
        await expect(exec({ projectId })).rejects.toThrow(
            "One of ipAddresses, cidrBlocks, currentIpAddress must be provided."
        );
    });

    it("includes the currentIpAddress arg when current IP lookup is supported", () => {
        expect(Object.keys(tool.argsShape)).toContain("currentIpAddress");
    });

    describe("when current IP lookup is not supported", () => {
        beforeEach(() => {
            tool = makeTool({ ...mockApiClient, supportsCurrentIpLookup: false });
        });

        it("omits the currentIpAddress arg", () => {
            expect(Object.keys(tool.argsShape)).not.toContain("currentIpAddress");
        });

        it("directs the user to provide explicit IPs when no inputs are provided", async () => {
            await expect(exec({ projectId })).rejects.toThrow("Either ipAddresses or cidrBlocks must be provided.");
        });

        it("still creates entries for explicitly provided IPs", async () => {
            await exec({ projectId, ipAddresses: ["192.168.1.1"] });

            expect(mockApiClient.getIpInfo).not.toHaveBeenCalled();
            expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: projectId } },
                    body: [{ groupId: projectId, ipAddress: "192.168.1.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
                },
                expect.anything()
            );
        });
    });

    describe("shared schema caching by IP-lookup variant", () => {
        type CapturedSchema = { safeParse: (value: unknown) => { success: boolean } };

        function registeredInputSchema(t: CreateAccessListTool): CapturedSchema {
            let inputSchema: unknown;
            const mockServer = {
                mcpServer: {
                    registerTool: (_name: string, config: { inputSchema: unknown }): RegisteredTool => {
                        inputSchema = config.inputSchema;
                        return { enabled: true, disable: vi.fn(), enable: vi.fn() } as unknown as RegisteredTool;
                    },
                },
            };
            t.register(mockServer as never);
            return inputSchema as CapturedSchema;
        }

        it("caches the two variants separately without cross-talk", () => {
            const withLookup = registeredInputSchema(makeTool({ ...mockApiClient, supportsCurrentIpLookup: true }));
            const withoutLookup = registeredInputSchema(makeTool({ ...mockApiClient, supportsCurrentIpLookup: false }));

            // Distinct shapes must not collapse onto one shared cache entry.
            expect(withLookup).not.toBe(withoutLookup);
            expect(withLookup.safeParse({ projectId, currentIpAddress: true }).success).toBe(true);
            expect(withoutLookup.safeParse({ projectId, currentIpAddress: true }).success).toBe(false);
        });

        it("shares one schema instance across registrations of the same variant", () => {
            const a = registeredInputSchema(makeTool({ ...mockApiClient, supportsCurrentIpLookup: true }));
            const b = registeredInputSchema(makeTool({ ...mockApiClient, supportsCurrentIpLookup: true }));
            expect(a).toBe(b);
        });
    });

    it("uses custom comment when provided", async () => {
        await exec({
            projectId,
            ipAddresses: ["192.168.1.1"],
            comment: "office network",
        });

        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith(
            {
                params: { path: { groupId: projectId } },
                body: [{ groupId: projectId, ipAddress: "192.168.1.1", comment: "office network" }],
            },
            expect.anything()
        );
    });
});
