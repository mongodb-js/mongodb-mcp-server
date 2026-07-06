import { defaultTestConfig, setupIntegrationTest, type IntegrationTest } from "../../helpers.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import { describe } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Atlas Local create-deployment can take longer than the MCP SDK's default 60s
// request timeout when the docker image has to be pulled from a cold cache.
const ATLAS_LOCAL_CALL_TIMEOUT_MS = 180_000;
// Loading sample data downloads several hundred MBs of seed data on container
// startup, which adds substantial time on top of the regular healthcheck wait.
const ATLAS_LOCAL_SAMPLE_DATA_TIMEOUT_MS = 600_000;

/**
 * Helper function to create an Atlas Local deployment via the MCP SDK client. The creation may take a while
 * if the required Docker image is not already cached, so a longer timeout is used to avoid test failures in that case.
 */
export function createAtlasLocalDeployment(
    integration: IntegrationTest,
    args: { deploymentName?: string; imageTag?: string; loadSampleData?: boolean } = {}
): ReturnType<Client["callTool"]> {
    const timeout = args.loadSampleData ? ATLAS_LOCAL_SAMPLE_DATA_TIMEOUT_MS : ATLAS_LOCAL_CALL_TIMEOUT_MS;
    return integration.mcpClient().callTool(
        {
            name: "atlas-local-create-deployment",
            arguments: args,
        },
        undefined,
        { timeout }
    );
}

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

/**
 * Options for Atlas Local integration tests.
 */
export interface AtlasLocalIntegrationOptions {
    config?: UserConfig;
}

/**
 * Helper function to setup integration tests for Atlas Local tools.
 * Automatically skips tests on macOS in GitHub Actions where Docker is not available.
 * Pass options.config to inject a config into the server, otherwise defaultTestConfig is used.
 */
export function describeWithAtlasLocal(
    name: string,
    fn: IntegrationTestFunction,
    options?: AtlasLocalIntegrationOptions
): void {
    describe.skipIf(isMacOSInGitHubActions)(name, () => {
        const config = options?.config ?? defaultTestConfig;
        const integration = setupIntegrationTest(() => config);
        fn(integration);
    });
}

/**
 * Helper function to describe tests that should only run on macOS in GitHub Actions.
 * Used for testing that Atlas Local tools are properly disabled on unsupported platforms.
 */
export function describeWithAtlasLocalDisabled(
    name: string,
    fn: IntegrationTestFunction,
    options?: AtlasLocalIntegrationOptions
): void {
    describe.skipIf(!isMacOSInGitHubActions)(name, () => {
        const config = options?.config ?? defaultTestConfig;
        const integration = setupIntegrationTest(() => config);
        fn(integration);
    });
}
