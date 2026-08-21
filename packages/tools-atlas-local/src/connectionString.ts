import type { Client } from "@mongodb-js/atlas-local";
import { sleep } from "@mongodb-js/mcp-core";

/** Keep well under the MCP client's default ~60s request timeout. */
export const DEFAULT_MAX_ATTEMPTS = 60;
export const DEFAULT_INTERVAL_MS = 500;

export class AtlasLocalDeploymentNotReadyError extends Error {
    readonly deploymentName: string;

    constructor(deploymentName: string) {
        super(`Atlas Local deployment "${deploymentName}" is still starting up`);
        this.name = "AtlasLocalDeploymentNotReadyError";
        this.deploymentName = deploymentName;
    }
}

function isMissingPortBindingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Missing port binding information");
}

/**
 * atlas-local-create-deployment can return before Docker publishes port bindings.
 * Retry briefly so connect usually works without exceeding MCP request timeouts.
 */
export async function waitForConnectionString(
    client: Client,
    deploymentName: string,
    {
        maxAttempts = DEFAULT_MAX_ATTEMPTS,
        intervalMs = DEFAULT_INTERVAL_MS,
    }: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await client.getConnectionString(deploymentName);
        } catch (error: unknown) {
            if (!isMissingPortBindingError(error)) {
                throw error;
            }

            if (attempt < maxAttempts - 1) {
                await sleep(intervalMs);
            }
        }
    }

    throw new AtlasLocalDeploymentNotReadyError(deploymentName);
}
