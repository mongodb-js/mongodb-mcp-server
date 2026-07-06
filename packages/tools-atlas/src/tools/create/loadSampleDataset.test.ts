import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { LoadSampleDatasetTool, LoadSampleDatasetArgs } from "./loadSampleDataset.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient, SampleDatasetStatus } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

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

    function buildTool(): LoadSampleDatasetTool {
        mockApiClient = {
            requestSampleDatasetLoad: vi.fn(),
            getSampleDatasetLoad: vi.fn(),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        } as unknown as ICompositeLogger;

        const mockSession = {
            sessionId: "test-session",
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: undefined,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            keychain: new Keychain(),
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
        } as unknown as IAtlasSession;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as IElicitation;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: LoadSampleDatasetTool.toolName,
            category: "atlas",
            operationType: LoadSampleDatasetTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
        };

        return new LoadSampleDatasetTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](
            z.object(LoadSampleDatasetArgs).parse(args) as never,
            { signal: new AbortController().signal } as never
        );

    function getStructuredContent(result: { structuredContent?: unknown }): Record<string, unknown> {
        expect(result.structuredContent).toBeDefined();
        return result.structuredContent as Record<string, unknown>;
    }

    function getTextContent(result: { content: unknown[] }, index: number): string {
        const item = result.content[index] as { text?: string } | undefined;
        expect(item?.text).toBeDefined();
        return item!.text!;
    }

    beforeEach(() => {
        tool = buildTool();
    });

    describe("initiating a load (clusterName provided)", () => {
        beforeEach(() => {
            mockApiClient.requestSampleDatasetLoad!.mockResolvedValue(WORKING_STATUS);
        });

        it("calls requestSampleDatasetLoad with the correct path params", async () => {
            await exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME });

            expect(mockApiClient.requestSampleDatasetLoad).toHaveBeenCalledTimes(1);
            expect(mockApiClient.requestSampleDatasetLoad).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: PROJECT_ID, name: CLUSTER_NAME } },
                },
                expect.anything()
            );
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
            expect(mockApiClient.getSampleDatasetLoad).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: PROJECT_ID, sampleDatasetId: JOB_ID } },
                },
                expect.anything()
            );
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
        it("throws and calls no API when both clusterName and jobId are provided", async () => {
            await expect(exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME, jobId: JOB_ID })).rejects.toThrow(
                "Provide exactly one of"
            );

            expect(mockApiClient.requestSampleDatasetLoad).not.toHaveBeenCalled();
            expect(mockApiClient.getSampleDatasetLoad).not.toHaveBeenCalled();
        });

        it("throws and calls no API when neither clusterName nor jobId is provided", async () => {
            await expect(exec({ projectId: PROJECT_ID })).rejects.toThrow("Provide exactly one of");

            expect(mockApiClient.requestSampleDatasetLoad).not.toHaveBeenCalled();
            expect(mockApiClient.getSampleDatasetLoad).not.toHaveBeenCalled();
        });
    });

    describe("API failure handling", () => {
        it("throws when requestSampleDatasetLoad throws", async () => {
            mockApiClient.requestSampleDatasetLoad!.mockRejectedValue(new Error("Atlas is down"));

            await expect(exec({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME })).rejects.toThrow("Atlas is down");
        });

        it("throws when getSampleDatasetLoad throws", async () => {
            mockApiClient.getSampleDatasetLoad!.mockRejectedValue(new Error("Job not found"));

            await expect(exec({ projectId: PROJECT_ID, jobId: JOB_ID })).rejects.toThrow("Job not found");
        });
    });
});
