import type { Client } from "@mongodb-js/atlas-local";
import { sleep } from "../managedTimeout.js";

const DEFAULT_MAX_ATTEMPTS = 600;
const DEFAULT_INTERVAL_MS = 500;

function isMissingPortBindingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Missing port binding information");
}

/**
 * atlas-local-create-deployment can return before Docker publishes port bindings.
 * Wait until getConnectionString succeeds so connect works right after create.
 */
export async function waitForConnectionString(
    client: Client,
    deploymentName: string,
    {
        maxAttempts = DEFAULT_MAX_ATTEMPTS,
        intervalMs = DEFAULT_INTERVAL_MS,
    }: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await client.getConnectionString(deploymentName);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            lastError = err;

            if (!isMissingPortBindingError(err)) {
                throw err;
            }

            await sleep(intervalMs);
        }
    }

    throw (
        lastError ?? new Error(`Timed out waiting for connection string for Atlas Local deployment "${deploymentName}"`)
    );
}
