import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { createTestApiClient, testServerMetadata } from "../../integrationHelpers.js";
import {
    provisionStreamsWorkspace,
    teardownStreamsWorkspace,
    type StreamsWorkspaceFixture,
} from "./streamsWorkspace.js";

/**
 * Vitest global setup for the `streams-tests` project.
 *
 * Provisions ONE shared Atlas project + streams workspace + free-tier cluster
 * for the whole run and makes it available to every streams test file via
 * `inject("atlasStreamsWorkspace")`. Previously each streams test file
 * provisioned (and tore down) its own workspace, which caused the CI timeouts
 * and project leaks this refactor is fixing.
 *
 * The setup is a no-op (and no fixture is provided) when Atlas credentials are
 * not configured — the streams tests themselves are `describe.skip`ped in that
 * case via `describeWithStreams`.
 *
 * The returned teardown function runs after ALL test files have completed and
 * deletes the workspace, cluster and project best-effort.
 */
export default async function setup(context: {
    provide: (key: string, value: unknown) => void;
}): Promise<(() => Promise<void>) | undefined> {
    if (!process.env.MDB_MCP_API_CLIENT_ID?.length || !process.env.MDB_MCP_API_CLIENT_SECRET?.length) {
        console.log("streamsGlobalSetup: Atlas credentials not configured, skipping shared workspace provisioning.");
        return undefined;
    }

    console.log("streamsGlobalSetup: provisioning shared Atlas Streams workspace...");
    const apiClient = createApiClient();
    const fixture: StreamsWorkspaceFixture | undefined = await provisionStreamsWorkspace(apiClient).catch((error) => {
        // Do not abort the whole long-running run (performanceAdvisor etc.);
        // the streams tests will fail loudly in withWorkspace's beforeAll with
        // an actionable message about the fixture not being provisioned.
        console.error("streamsGlobalSetup: failed to provision shared workspace:", error);
        return undefined;
    });

    if (!fixture) {
        return undefined;
    }

    context.provide("atlasStreamsWorkspace", fixture);
    console.log(
        `streamsGlobalSetup: shared workspace ready (project ${fixture.projectId}, workspace ${fixture.workspaceName}, cluster ${fixture.clusterName}).`
    );

    return async () => {
        console.log("streamsGlobalSetup: tearing down shared Atlas Streams workspace...");
        try {
            await teardownStreamsWorkspace(apiClient, fixture);
            console.log("streamsGlobalSetup: shared workspace teardown complete.");
        } catch (error) {
            // A leaked fixture is still picked up by the hourly cleanup job
            // (cleanupAtlasTestLeftovers), so log but never throw here.
            console.error("streamsGlobalSetup: shared workspace teardown failed:", error);
        }
    };
}

function createApiClient(): ApiClient {
    const baseUrl = process.env.MDB_MCP_API_BASE_URL || "https://cloud-dev.mongodb.com";
    return createTestApiClient({
        baseUrl,
        serverMetadata: testServerMetadata,
        logger: new CompositeLogger(),
        clientId: process.env.MDB_MCP_API_CLIENT_ID || "",
        clientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "",
    });
}
