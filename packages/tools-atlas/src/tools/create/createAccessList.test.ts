import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { CreateAccessListTool } from "./createAccessList.js";
import { DEFAULT_ACCESS_LIST_COMMENT } from "../../helpers/accessListUtils.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

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

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        } as unknown as ICompositeLogger;

        const mockSession = {
            sessionId: "test-session",
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: undefined,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            keychain: new Keychain(),
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
        } as unknown as IAtlasSession;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: CreateAccessListTool.toolName,
            category: "atlas",
            operationType: CreateAccessListTool.operationType,
            session: mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as IElicitation,
            metrics: new MockMetrics(),
        };

        tool = new CreateAccessListTool(params);
    });

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
        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith({
            params: { path: { groupId: projectId } },
            body: [
                { groupId: projectId, ipAddress: "192.168.1.1", comment: DEFAULT_ACCESS_LIST_COMMENT },
                { groupId: projectId, cidrBlock: "10.0.0.0/24", comment: DEFAULT_ACCESS_LIST_COMMENT },
            ],
        });
    });

    it("includes current IP when currentIpAddress is true", async () => {
        await exec({
            projectId,
            currentIpAddress: true,
        });

        expect(mockApiClient.getIpInfo).toHaveBeenCalled();
        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith({
            params: { path: { groupId: projectId } },
            body: [{ groupId: projectId, ipAddress: currentIpAddress, comment: DEFAULT_ACCESS_LIST_COMMENT }],
        });
    });

    it("throws when no inputs are provided", async () => {
        await expect(exec({ projectId })).rejects.toThrow(
            "One of  ipAddresses, cidrBlocks, currentIpAddress must be provided."
        );
    });

    it("uses custom comment when provided", async () => {
        await exec({
            projectId,
            ipAddresses: ["192.168.1.1"],
            comment: "office network",
        });

        expect(mockApiClient.createAccessListEntry).toHaveBeenCalledWith({
            params: { path: { groupId: projectId } },
            body: [{ groupId: projectId, ipAddress: "192.168.1.1", comment: "office network" }],
        });
    });
});
