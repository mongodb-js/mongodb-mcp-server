import { expect, it, vi } from "vitest";
import { describeWithAtlas, withProject } from "../tools/atlas/atlasHelpers.js";
import { runSharedTierAlertsHook } from "../../../src/common/atlas/sharedTierAlertsHook.js";

describeWithAtlas("shared-tier-alerts-hook integration", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        it("calls listAlerts with groupId and OPEN status without throwing", async () => {
            const server = integration.mcpServer();
            const apiClient = server.getApiClient();
            const listSpy = vi.spyOn(apiClient, "listAlerts").mockResolvedValue({ results: [] });

            await expect(
                runSharedTierAlertsHook({
                    projectId: getProjectId(),
                    clusterName: "integration-test-cluster",
                    instanceType: "FREE",
                    apiClient,
                    logger: server.session.logger,
                })
            ).resolves.toBeDefined();

            expect(listSpy).toHaveBeenCalled();

            const projectId = getProjectId();
            const firstListAlertsArg = listSpy.mock.calls[0]?.[0] as
                | {
                      params: {
                          path: { groupId: string };
                          query: {
                              status?: string;
                              itemsPerPage?: number;
                              pageNum?: number;
                              includeCount?: boolean;
                          };
                      };
                  }
                | undefined;
            expect(firstListAlertsArg).toBeDefined();
            expect(firstListAlertsArg?.params.path.groupId).toBe(projectId);
            expect(firstListAlertsArg?.params.query.status).toBe("OPEN");
            expect(firstListAlertsArg?.params.query.itemsPerPage).toBe(100);
            expect(firstListAlertsArg?.params.query.pageNum).toBe(1);
            expect(firstListAlertsArg?.params.query.includeCount).toBe(true);

            listSpy.mockRestore();
        });
    });
});
