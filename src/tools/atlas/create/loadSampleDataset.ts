import { type ToolArgs, type ToolResult, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs, CommonArgs } from "../../args.js";
import type { SampleDatasetStatus } from "../../../common/atlas/openapi.js";
import { z } from "zod";

export const LoadSampleDatasetArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID that owns the cluster"),
    clusterName: AtlasArgs.clusterName()
        .optional()
        .describe(
            "Cluster name to load the sample dataset into. Provide this to initiate a new load. Mutually exclusive with jobId."
        ),
    jobId: CommonArgs.objectId("jobId")
        .optional()
        .describe(
            "Job id returned by a previous load request. Provide this to check the status of an in-progress load. Mutually exclusive with clusterName."
        ),
};

const LoadSampleDatasetOutputSchema = {
    jobId: z.string().describe("Unique identifier for the sample dataset load job"),
    clusterName: z.string().describe("Name of the cluster the sample dataset is being loaded into"),
    state: z.enum(["WORKING", "FAILED", "COMPLETED"]).describe("Current state of the load job"),
    createDate: z.string().describe("ISO 8601 timestamp (UTC) when the load was initiated"),
    completeDate: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp (UTC) when the load completed (only set when state is COMPLETED or FAILED)"),
    errorMessage: z.string().optional().describe("Failure reason (only set when state is FAILED)"),
};

export type LoadSampleDatasetOutput = z.infer<z.ZodObject<typeof LoadSampleDatasetOutputSchema>>;

export class LoadSampleDatasetTool extends AtlasToolBase {
    static toolName = "atlas-load-sample-dataset";
    public description =
        "Load a MongoDB sample dataset into an Atlas cluster, or check the status of a previously-initiated load. " +
        "To start a new load, provide `clusterName` — the load runs asynchronously and the response includes a " +
        "`jobId` and initial state. To check progress, call this tool again with `jobId` " +
        "(sample dataset loads typically take 1–5 minutes). State can be WORKING, COMPLETED, or FAILED.";
    static operationType: OperationType = "create";
    public argsShape = {
        ...LoadSampleDatasetArgs,
    };
    public override outputSchema = LoadSampleDatasetOutputSchema;

    protected async execute({
        projectId,
        clusterName,
        jobId,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        let status: SampleDatasetStatus;
        let headerText: string;
        if (jobId !== undefined && clusterName === undefined) {
            status = await this.apiClient.getSampleDatasetLoad({
                params: { path: { groupId: projectId, sampleDatasetId: jobId } },
            });

            headerText = `Sample dataset load status for cluster "${status.clusterName}" in project ${projectId}.`;
        } else if (clusterName !== undefined && jobId === undefined) {
            status = await this.apiClient.requestSampleDatasetLoad({
                params: { path: { groupId: projectId, name: clusterName } },
            });

            headerText = `Sample dataset load requested for cluster "${status.clusterName}" in project ${projectId}.`;
        } else {
            throw new Error(
                "Provide exactly one of `clusterName` (to initiate a new sample dataset load) or `jobId` (to check the status of a previous load)."
            );
        }

        const structuredContent: LoadSampleDatasetOutput = {
            jobId: status._id as string,
            clusterName: status.clusterName as string,
            state: status.state || "WORKING",
            createDate: status.createDate as string,
            ...(status.completeDate ? { completeDate: status.completeDate } : {}),
            ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
        };

        return {
            content: [
                { type: "text", text: headerText },
                { type: "text", text: JSON.stringify(structuredContent) },
            ],
            structuredContent,
        };
    }
}
