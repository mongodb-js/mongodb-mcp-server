import { defaultTestConfig, setupIntegrationTest, type IntegrationTest } from "../../integrationHelpers.js";
import type { UserConfig } from "mongodb-mcp-server";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { describe } from "vitest";
import { execFileSync } from "node:child_process";
import type { Client } from "@modelcontextprotocol/client";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Atlas Local create-deployment can take longer than the MCP SDK's default 60s
// request timeout when the docker image has to be pulled from a cold cache.
const ATLAS_LOCAL_CALL_TIMEOUT_MS = 180_000;
// Loading sample data downloads several hundred MBs of seed data on container
// startup, which adds substantial time on top of the regular healthcheck wait.
// The create-deployment tool bounds its healthcheck wait at 480s, so this call
// timeout must be above that but below the 600s vitest test timeout
// (SAMPLE_DATA_TEST_TIMEOUT_MS in createDeployment.test.ts): a stalled
// deployment then surfaces as a tool error instead of a silent test timeout
// (CLOUDP-459388).
const ATLAS_LOCAL_SAMPLE_DATA_TIMEOUT_MS = 540_000;

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
        { timeout }
    );
}

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

/**
 * Logs docker container status, healthcheck state, and recent container logs
 * for an Atlas Local deployment. The container runner only logs at debug
 * level, so a stalled deployment is otherwise completely silent when a test
 * fails (CLOUDP-459388).
 */
export function logAtlasLocalDeploymentDiagnostics(deploymentName: string): void {
    try {
        const containers = execFileSync(
            "docker",
            ["ps", "-a", "--filter", `name=${deploymentName}`, "--format", "{{.Names}}"],
            { encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }
        )
            .split("\n")
            .map((name) => name.trim())
            .filter(Boolean);
        if (containers.length === 0) {
            console.warn(`[atlas-local diagnostics] no docker container found matching ${deploymentName}`);
            return;
        }
        for (const container of containers) {
            const commands: string[][] = [
                ["inspect", "--format", "{{.State.Status}}", container],
                ["inspect", "--format", "{{json .State.Health}}", container],
                ["logs", "--tail", "100", container],
            ];
            for (const args of commands) {
                try {
                    const output = execFileSync("docker", args, {
                        encoding: "utf8",
                        timeout: 10_000,
                        maxBuffer: 8 * 1024 * 1024,
                    });
                    console.info(`[atlas-local diagnostics] docker ${args.join(" ")}\n${output}`);
                } catch (error) {
                    console.warn(`[atlas-local diagnostics] docker ${args.join(" ")} failed:`, error);
                }
            }
        }
    } catch (error) {
        console.warn(`[atlas-local diagnostics] failed to inspect containers for ${deploymentName}:`, error);
    }
}

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
export function describeWithAtlasLocal({
    name,
    fn,
    options,
}: {
    name: string;
    fn: IntegrationTestFunction;
    options?: AtlasLocalIntegrationOptions;
}): void {
    describe.skipIf(isMacOSInGitHubActions)(name, () => {
        const config = options?.config ?? defaultTestConfig;
        const integration = setupIntegrationTest(() => config, {
            tools: [...AtlasLocalTools, ...MongoDBTools],
        });
        fn(integration);
    });
}

/**
 * Helper function to describe tests that should only run on macOS in GitHub Actions.
 * Used for testing that Atlas Local tools are properly disabled on unsupported platforms.
 */
export function describeWithAtlasLocalDisabled({
    name,
    fn,
    options,
}: {
    name: string;
    fn: IntegrationTestFunction;
    options?: AtlasLocalIntegrationOptions;
}): void {
    describe.skipIf(!isMacOSInGitHubActions)(name, () => {
        const config = options?.config ?? defaultTestConfig;
        const integration = setupIntegrationTest(() => config, { tools: AtlasLocalTools });
        fn(integration);
    });
}
