import { expect, it, vi } from "vitest";
import * as clusterModule from "../../../src/common/atlas/cluster.js";
import type { Cluster } from "../../../src/common/atlas/cluster.js";
import { describeWithAtlas, withProject } from "../tools/atlas/atlasHelpers.js";
import { runSharedTierAlertsHook } from "../../../src/common/atlas/sharedTierAlertsHook.js";
import type { Telemetry } from "../../../src/telemetry/telemetry.js";

describeWithAtlas("shared-tier-alerts-hook integration", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        it("calls listAlerts with groupId and OPEN status without throwing", async () => {
            const server = integration.mcpServer();
            const apiClient = server.getApiClient();
            const inspectSpy = vi.spyOn(clusterModule, "inspectCluster").mockResolvedValue({ instanceType: "FREE" } as Cluster);
            const listSpy = vi.spyOn(apiClient, "listAlerts").mockResolvedValue({ results: [] });

            const telemetry = {
                isTelemetryEnabled: () => true,
                emitEvents: vi.fn(),
            } as unknown as Telemetry;

            await expect(
                runSharedTierAlertsHook({
                    projectId: getProjectId(),
                    clusterName: "integration-test-cluster",
                    apiClient,
                    telemetry,
                    logger: server.session.logger,
                })
            ).resolves.toBeDefined();

            expect(inspectSpy).toHaveBeenCalled();
            expect(listSpy).toHaveBeenCalled();
            expect(listSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    params: expect.objectContaining({
                        path: { groupId: getProjectId() },
                        query: expect.objectContaining({
                            status: "OPEN",
                            itemsPerPage: 100,
                            pageNum: 1,
                            includeCount: true,
                        }),
                    }),
                })
            );

            inspectSpy.mockRestore();
            listSpy.mockRestore();
        });
    });
});
