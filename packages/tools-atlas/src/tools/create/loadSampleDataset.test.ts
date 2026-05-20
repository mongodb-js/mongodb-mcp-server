import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams, IAtlasConfig, IAtlasSession } from "@mongodb-js/mcp-tools-atlas";
import { LoadSampleDatasetTool } from "@mongodb-js/mcp-tools-atlas";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { Elicitation, CompositeLogger } from "@mongodb-js/mcp-core";
import { Keychain } from "@mongodb-js/mcp-core";
import type { ApiClient, SampleDatasetStatus } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import type { DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";

const PROJECT_ID = "651b1d2a3a3f3a0001a1b2c3";
const CLUSTER_NAME = "MyCluster";
const JOB_ID = "651b1d2a3a3f3a0001a1b2c4";

const WORKING_STATUS: SampleDatasetStatus = {
    _id: JOB_ID,
    clusterName: CLUSTER_NAME,
    state: "WORKING",
    createDate: "2026-05-21T00:00:00Z",
};

const COMPLETED_STATUS: SampleDatasetStatus = {
    _id: JOB_ID,
    clusterName: CLUSTER_NAME,
    state: "COMPLETED",
    createDate: "2026-05-21T00:00:00Z",
    completeDate: "2026-05-21T00:03:42Z",
};

const FAILED_STATUS: SampleDatasetStatus = {
    _id: JOB_ID,
    clusterName: CLUSTER_NAME,
    state: "FAILED",
    createDate: "2026-05-21T00:00:00Z",
    completeDate: "2026-05-21T00:01:00Z",
    errorMessage: "Cluster is not in IDLE state.",
};

describe("LoadSampleDatasetTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: LoadSampleDatasetTool;

    beforeEach(() => {
        mockApiClient = {
            requestSampleDatasetLoad: vi.fn(),
            getSampleDatasetLoad: vi.fn(),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: new Keychain(),
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
                atlasTemporaryDatabaseUserLifetimeMs: 3600000,
            } as unknown as IAtlasConfig,
        } as unknown as IAtlasSession;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as AtlasTelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams<IAtlasSession, DefaultPrometheusMetricDefinitions> = {
            name: LoadSampleDatasetTool.toolName,
            category: "atlas",
            operationType: LoadSampleDatasetTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new LoadSampleDatasetTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["invoke"](args as never, {} as never);

    function getStructuredContent(result: { structuredContent?: unknown }): Record<string, unknown> {
        expect(result.structuredContent).toBeDefined();
        return result.structuredContent as Record<string, unknown>;
    }

    function getTextContent(result: { content: unknown[] }, index: number): string {
        const item = result.content[index] as { text?: string } | undefined;
        expect(item?.text).toBeDefined();
        return item!.text!;
    }

    describe("initiating a load (clusterName provided)", () => {
        beforeEach(() => {
            mockApiClient.requestSampleDatasetLoad!.mockResolvedValue(WORKING_STATUS);
        });

        it("calls requestSampleDatasetLoad with the correct path params", async () => {
            await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            expect(mockApiClient.requestSampleDatasetLoad).toHaveBeenCalledTimes(1);
            expect(mockApiClient.requestSampleDatasetLoad).toHaveBeenCalledWith({
                params: { path: { groupId: PROJECT_ID, name: CLUSTER_NAME } },
            });
            expect(mockApiClient.getSampleDatasetLoad).not.toHaveBeenCalled();
        });

        it("returns a successful response with a heading mentioning the cluster and project", async () => {
            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            expect(result.isError).toBeFalsy();
            const heading = getTextContent(result, 0);
            expect(heading).toContain("load requested");
            expect(heading).toContain(CLUSTER_NAME);
            expect(heading).toContain(PROJECT_ID);
        });

        it("maps the API _id to jobId in structuredContent and includes always-present fields", async () => {
            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            const structured = getStructuredContent(result);
            expect(structured).toEqual({
                jobId: JOB_ID,
                clusterName: CLUSTER_NAME,
                state: "WORKING",
                createDate: "2026-05-21T00:00:00Z",
            });
        });

        it("omits completeDate and errorMessage from structuredContent when not present in the API response", async () => {
            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            const structured = getStructuredContent(result);
            expect(structured).not.toHaveProperty("completeDate");
            expect(structured).not.toHaveProperty("errorMessage");
        });

        it("serializes the structuredContent as JSON in a second content block", async () => {
            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            const structured = getStructuredContent(result);
            const serialized = getTextContent(result, 1);
            expect(JSON.parse(serialized)).toEqual(structured);
        });
    });

    describe("checking status (jobId provided)", () => {
        it("calls getSampleDatasetLoad with the correct path params", async () => {
            mockApiClient.getSampleDatasetLoad!.mockResolvedValue(WORKING_STATUS);

            await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            expect(mockApiClient.getSampleDatasetLoad).toHaveBeenCalledTimes(1);
            expect(mockApiClient.getSampleDatasetLoad).toHaveBeenCalledWith({
                params: { path: { groupId: PROJECT_ID, sampleDatasetId: JOB_ID } },
            });
            expect(mockApiClient.requestSampleDatasetLoad).not.toHaveBeenCalled();
        });

        it("returns a heading mentioning the load status", async () => {
            mockApiClient.getSampleDatasetLoad!.mockResolvedValue(WORKING_STATUS);

            const result = await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            expect(result.isError).toBeFalsy();
            const heading = getTextContent(result, 0);
            expect(heading).toContain("load status");
            expect(heading).toContain(CLUSTER_NAME);
            expect(heading).toContain(PROJECT_ID);
        });

        it("includes completeDate in structuredContent for a COMPLETED job", async () => {
            mockApiClient.getSampleDatasetLoad!.mockResolvedValue(COMPLETED_STATUS);

            const result = await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            const structured = getStructuredContent(result);
            expect(structured).toEqual({
                jobId: JOB_ID,
                clusterName: CLUSTER_NAME,
                state: "COMPLETED",
                createDate: "2026-05-21T00:00:00Z",
                completeDate: "2026-05-21T00:03:42Z",
            });
            expect(structured).not.toHaveProperty("errorMessage");
        });

        it("includes errorMessage in structuredContent for a FAILED job", async () => {
            mockApiClient.getSampleDatasetLoad!.mockResolvedValue(FAILED_STATUS);

            const result = await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            const structured = getStructuredContent(result);
            expect(structured).toMatchObject({
                jobId: JOB_ID,
                state: "FAILED",
                completeDate: "2026-05-21T00:01:00Z",
                errorMessage: "Cluster is not in IDLE state.",
            });
        });

        it("serializes the structuredContent as JSON in a second content block", async () => {
            mockApiClient.getSampleDatasetLoad!.mockResolvedValue(COMPLETED_STATUS);

            const result = await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            const structured = getStructuredContent(result);
            const serialized = getTextContent(result, 1);
            expect(JSON.parse(serialized)).toEqual(structured);
        });
    });

    describe("argument validation", () => {
        it("returns an error and calls no API when both clusterName and jobId are provided", async () => {
            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME, jobId: JOB_ID });

            expect(result.isError).toBe(true);
            const text = getTextContent(result, 0);
            expect(text).toContain("Provide exactly one of");
            expect(text).toContain("clusterName");
            expect(text).toContain("jobId");

            expect(mockApiClient.requestSampleDatasetLoad).not.toHaveBeenCalled();
            expect(mockApiClient.getSampleDatasetLoad).not.toHaveBeenCalled();
        });

        it("returns an error and calls no API when neither clusterName nor jobId is provided", async () => {
            const result = await exec({ projectId: PROJECT_ID });

            expect(result.isError).toBe(true);
            const text = getTextContent(result, 0);
            expect(text).toContain("Provide exactly one of");
            expect(text).toContain("clusterName");
            expect(text).toContain("jobId");

            expect(mockApiClient.requestSampleDatasetLoad).not.toHaveBeenCalled();
            expect(mockApiClient.getSampleDatasetLoad).not.toHaveBeenCalled();
        });
    });

    describe("API failure handling", () => {
        it("returns isError when requestSampleDatasetLoad throws", async () => {
            mockApiClient.requestSampleDatasetLoad!.mockRejectedValue(new Error("Atlas is down"));

            const result = await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            expect(result.isError).toBe(true);
            expect(getTextContent(result, 0)).toContain("Atlas is down");
        });

        it("returns isError when getSampleDatasetLoad throws", async () => {
            mockApiClient.getSampleDatasetLoad!.mockRejectedValue(new Error("Job not found"));

            const result = await exec({ projectId: PROJECT_ID, jobId: JOB_ID });

            expect(result.isError).toBe(true);
            expect(getTextContent(result, 0)).toContain("Job not found");
        });
    });
});
