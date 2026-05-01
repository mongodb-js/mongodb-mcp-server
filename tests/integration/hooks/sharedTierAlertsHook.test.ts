import { expect, it, vi } from "vitest";
import * as clusterModule from "../../../src/common/atlas/cluster.js";
import type { Cluster } from "../../../src/common/atlas/cluster.js";
import { describeWithAtlas, withProject } from "../tools/atlas/atlasHelpers.js";
import { runSharedTierAlertsHook } from "../../../src/common/atlas/sharedTierAlertsHook.js";

describeWithAtlas("shared-tier-alerts-hook integration", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        it("calls listAlerts with groupId and OPEN status without throwing", async () => {
            const server = integration.mcpServer();
            const apiClient = server.getApiClient();
            const inspectSpy = vi.spyOn(clusterModule, "inspectCluster").mockResolvedValue({ instanceType: "FREE" } as Cluster);
            const listSpy = vi.spyOn(apiClient, "listAlerts").mockResolvedValue({ results: [] });

            await expect(
                runSharedTierAlertsHook({
                    projectId: getProjectId(),
                    clusterName: "integration-test-cluster",
                    apiClient,
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
