import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-create-backup-snapshot", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const createBackupSnapshot = tools.find((tool) => tool.name === "atlas-create-backup-snapshot");
        expectDefined(createBackupSnapshot);
        expect(createBackupSnapshot.inputSchema.type).toBe("object");
        expectDefined(createBackupSnapshot.inputSchema.properties);
        expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("projectId");
        expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("clusterName");
        expect(createBackupSnapshot.inputSchema.properties).toHaveProperty("description");
    });
});
