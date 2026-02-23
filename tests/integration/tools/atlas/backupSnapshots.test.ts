import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-list-backup-snapshots", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listBackupSnapshots = tools.find((tool) => tool.name === "atlas-list-backup-snapshots");
        expectDefined(listBackupSnapshots);
        expect(listBackupSnapshots.inputSchema.type).toBe("object");
        expectDefined(listBackupSnapshots.inputSchema.properties);
        expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("projectId");
        expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("clusterName");
        expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("limit");
        expect(listBackupSnapshots.inputSchema.properties).toHaveProperty("page");
    });
});
