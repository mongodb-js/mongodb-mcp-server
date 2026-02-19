import { describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-get-restore-job", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const getRestoreJob = tools.find((tool) => tool.name === "atlas-get-restore-job");
        expectDefined(getRestoreJob);
        expect(getRestoreJob.inputSchema.type).toBe("object");
        expectDefined(getRestoreJob.inputSchema.properties);
        expect(getRestoreJob.inputSchema.properties).toHaveProperty("projectId");
        expect(getRestoreJob.inputSchema.properties).toHaveProperty("clusterName");
        expect(getRestoreJob.inputSchema.properties).toHaveProperty("restoreJobId");
    });
});
