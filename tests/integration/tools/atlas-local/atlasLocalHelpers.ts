import { defaultTestConfig, setupIntegrationTest, type IntegrationTest } from "../../helpers.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import { describe } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

/**
 * Options for Atlas Local integration tests. Supports dependency injection of userConfig.
 */
export interface AtlasLocalIntegrationOptions {
    getUserConfig?: () => UserConfig;
}

/**
 * Helper function to setup integration tests for Atlas Local tools.
 * Automatically skips tests on macOS in GitHub Actions where Docker is not available.
 */
export function describeWithAtlasLocal(
    name: string,
    fn: IntegrationTestFunction,
    options?: AtlasLocalIntegrationOptions
): void {
    describe.skipIf(isMacOSInGitHubActions)(name, () => {
        const getUserConfig = options?.getUserConfig ?? ((): UserConfig => defaultTestConfig);
        const integration = setupIntegrationTest(getUserConfig);
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
        const getUserConfig = options?.getUserConfig ?? ((): UserConfig => defaultTestConfig);
        const integration = setupIntegrationTest(getUserConfig);
        fn(integration);
    });
}
