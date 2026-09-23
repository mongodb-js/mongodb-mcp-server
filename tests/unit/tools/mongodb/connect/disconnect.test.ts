import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { DisconnectTool } from "../../../../../src/tools/mongodb/connect/disconnect.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import { CompositeLogger } from "../../../../../src/common/logging/index.js";
import { MCPConnectionStore } from "../../../../../src/common/connectionStore.js";
import type { ConnectionRegistry, ConnectionEntry } from "../../../../../src/common/connectionRegistry.js";
import { DeviceId } from "../../../../../src/helpers/deviceId.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import { FakeConnectionManager } from "../../../mocks/connectionManager.js";
import { defaultTestConfig } from "../../../../integration/helpers.js";
import type { Keychain } from "../../../../../src/lib.js";

const ATLAS = {
    projectId: "proj1",
    clusterName: "cluster1",
    clusterId: "cluster-id-1",
};

function buildTool(connectionRegistry: ConnectionRegistry): DisconnectTool {
    const mockSession: Partial<Session> = {
        logger: new CompositeLogger(),
        connectionRegistry,
        mcpClient: { name: "test-client" },
        keychain: { allSecrets: [] } as unknown as Keychain,
        apiClient: {} as unknown as Session["apiClient"],
    };

    const mockConfig = {
        connectionString: undefined,
        confirmationRequiredTools: [],
        previewFeatures: [],
        disabledTools: [],
    } as unknown as UserConfig;

    const mockTelemetry = {
        isTelemetryEnabled: () => true,
        emitEvents: vi.fn(),
    } as unknown as Telemetry;

    const mockElicitation = {
        requestConfirmation: vi.fn(),
    } as unknown as Elicitation;

    const params: ToolConstructorParams = {
        name: DisconnectTool.toolName,
        category: "mongodb",
        operationType: DisconnectTool.operationType,
        session: mockSession as Session,
        config: mockConfig,
        telemetry: mockTelemetry,
        elicitation: mockElicitation,
        metrics: new MockMetrics(),
        uiRegistry: new UIRegistry(),
    };

    return new DisconnectTool(params);
}

describe("DisconnectTool", () => {
    let connectionRegistry: ConnectionRegistry;

    beforeEach(() => {
        connectionRegistry = new MCPConnectionStore({
            userConfig: defaultTestConfig,
            logger: new CompositeLogger(),
            deviceId: DeviceId.create(new CompositeLogger()),
            createConnectionManager: (): FakeConnectionManager => new FakeConnectionManager(),
        }).view();
    });

    it("captures Atlas attribution before revoking the entry", async () => {
        const entry: ConnectionEntry = await connectionRegistry.connect({
            settings: { connectionString: "mongodb://localhost:27017" },
            atlasCluster: ATLAS,
        });
        const connectionId = entry.connectionId;

        const tool = buildTool(connectionRegistry);

        const result = await tool["execute"]({ connectionId });

        // The explicit entry was revoked, so a fresh peek would find nothing.
        await expect(connectionRegistry.peek(connectionId)).resolves.toBeUndefined();

        const metadata = await tool["resolveTelemetryMetadata"]({ connectionId }, { result: result as CallToolResult });
        expect(metadata).toMatchObject({
            connection_id: connectionId,
            project_id: ATLAS.projectId,
            cluster_name: ATLAS.clusterName,
            cluster_id: ATLAS.clusterId,
        });
    });

    it("does not leak the previous snapshot into a later call", async () => {
        const entry: ConnectionEntry = await connectionRegistry.connect({
            settings: { connectionString: "mongodb://localhost:27017" },
            atlasCluster: ATLAS,
        });
        const connectionId = entry.connectionId;

        const tool = buildTool(connectionRegistry);

        await tool["execute"]({ connectionId });
        await tool["resolveTelemetryMetadata"]({ connectionId }, { result: { content: [] } as CallToolResult });

        // A second resolution with no prior capture yields no cluster metadata.
        const metadata = await tool["resolveTelemetryMetadata"](
            { connectionId },
            { result: { content: [] } as CallToolResult }
        );
        expect(metadata).toMatchObject({ connection_id: connectionId });
        expect(metadata).not.toHaveProperty("project_id");
        expect(metadata).not.toHaveProperty("cluster_id");
    });
});
