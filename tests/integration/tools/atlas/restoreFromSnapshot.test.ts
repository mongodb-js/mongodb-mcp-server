import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-restore-from-snapshot", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const restoreFromSnapshot = tools.find((tool) => tool.name === "atlas-restore-from-snapshot");
        expectDefined(restoreFromSnapshot);
        expect(restoreFromSnapshot.inputSchema.type).toBe("object");
        expectDefined(restoreFromSnapshot.inputSchema.properties);
        expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("projectId");
        expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("clusterName");
        expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("snapshotId");
        expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("targetProjectId");
        expect(restoreFromSnapshot.inputSchema.properties).toHaveProperty("targetClusterName");
    });
});
