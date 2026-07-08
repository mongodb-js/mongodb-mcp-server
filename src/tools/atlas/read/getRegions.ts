import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs, ToolExecutionContext, ToolResult } from "../../tool.js";
import { getClusterRegions } from "../../../common/atlas/clusterRegions.js";

const cloudProviderEnum = z.enum(["AWS", "GCP", "AZURE"]);

const GetRegionsOutputSchema = {
    providers: z.array(
        z.object({
            provider: cloudProviderEnum,
            regions: z.array(
                z.object({
                    name: z.string(),
                    location: z.string(),
                })
            ),
        })
    ),
};

export class GetRegionsTool extends AtlasToolBase {
    static toolName = "atlas-get-regions";
    static operationType: OperationType = "read";
    public description =
        "List MongoDB Atlas cluster regions available per cloud provider. " +
        "Returns Atlas region codes with human-readable location labels. " +
        "Call this before atlas-create-cluster or atlas-upgrade-cluster when the user specifies a provider/region in natural language, " +
        "or when you need to confirm a region code is valid for Atlas.";
    public argsShape = {
        provider: cloudProviderEnum
            .describe("Cloud provider to list regions for. Omit to return all providers.")
            .optional(),
    };
    public override outputSchema = GetRegionsOutputSchema;

    protected verifyAllowed(): boolean {
        if (!this.isFeatureEnabled("atlasGetRegions")) {
            return false;
        }
        return super.verifyAllowed();
    }

    protected execute(
        { provider }: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const providers = getClusterRegions(provider);

        const summary = provider
            ? `Available Atlas regions for ${provider}`
            : "Available Atlas regions for AWS, GCP, and AZURE";

        return Promise.resolve({
            content: [
                {
                    type: "text",
                    text: `${summary}:\n${JSON.stringify({ providers }, null, 2)}`,
                },
            ],
            structuredContent: { providers },
        });
    }
}
