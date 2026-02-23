import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-get-backup-snapshot", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const getBackupSnapshot = tools.find((tool) => tool.name === "atlas-get-backup-snapshot");
        expectDefined(getBackupSnapshot);
        expect(getBackupSnapshot.inputSchema.type).toBe("object");
        expectDefined(getBackupSnapshot.inputSchema.properties);
        expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("projectId");
        expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("clusterName");
        expect(getBackupSnapshot.inputSchema.properties).toHaveProperty("snapshotId");
    });
});
