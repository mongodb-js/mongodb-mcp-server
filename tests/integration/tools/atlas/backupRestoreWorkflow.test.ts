import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { describe, expect, it } from "vitest";

describeWithAtlas("atlas backup/restore workflow", (integration) => {
    describe("tool discoverability and input contracts", () => {
        it("exposes all workflow tools with required inputs", async () => {
            const { tools } = await integration.mcpClient().listTools();

            const createBackupSnapshot = tools.find((tool) => tool.name === "atlas-create-backup-snapshot");
            const listBackupSnapshots = tools.find((tool) => tool.name === "atlas-list-backup-snapshots");
            const getBackupSnapshot = tools.find((tool) => tool.name === "atlas-get-backup-snapshot");
            const restoreFromSnapshot = tools.find((tool) => tool.name === "atlas-restore-from-snapshot");
            const getRestoreJob = tools.find((tool) => tool.name === "atlas-get-restore-job");

            expectDefined(createBackupSnapshot);
            expectDefined(listBackupSnapshots);
            expectDefined(getBackupSnapshot);
            expectDefined(restoreFromSnapshot);
            expectDefined(getRestoreJob);

            expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("projectId");
            expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("clusterName");
            expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("retentionInDays");

            expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("projectId");
            expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("clusterName");
            expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("limit");
            expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("page");

            expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("projectId");
            expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("clusterName");
            expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("snapshotId");

            expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("projectId");
            expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("clusterName");
            expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("snapshotId");
            expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("targetProjectId");
            expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("targetClusterName");

            expect(getRestoreJob.inputSchema.properties).toHaveProperty("projectId");
            expect(getRestoreJob.inputSchema.properties).toHaveProperty("clusterName");
            expect(getRestoreJob.inputSchema.properties).toHaveProperty("restoreJobId");
        });
    });
});
