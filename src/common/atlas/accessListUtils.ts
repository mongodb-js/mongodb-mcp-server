import { ApiClient } from "./apiClient.js";
import logger, { LogId } from "../logger.js";
import { ApiClientError } from "./apiClientError.js";

export async function makeCurrentIpAccessListEntry(
    apiClient: ApiClient,
    projectId: string,
    comment: string = "Added by Atlas MCP"
) {
    const { currentIpv4Address } = await apiClient.getIpInfo();
    return {
        groupId: projectId,
        ipAddress: currentIpv4Address,
        comment,
    };
}

/**
 * Ensures the current public IP is in the access list for the given Atlas project.
 * If the IP is already present, this is a no-op.
 * @param apiClient The Atlas API client instance
 * @param projectId The Atlas project ID
 */
export async function ensureCurrentIpInAccessList(apiClient: ApiClient, projectId: string): Promise<void> {
    // Get the current public IP
    const entry = await makeCurrentIpAccessListEntry(apiClient, projectId, "Added by MCP pre-run access list helper");
    try {
        await apiClient.createProjectIpAccessList({
            params: { path: { groupId: projectId } },
            body: [entry],
        });
        logger.debug(
            LogId.atlasIpAccessListAdded,
            "accessListUtils",
            `IP access list created: ${JSON.stringify(entry)}`
        );
    } catch (err) {
        if (err instanceof ApiClientError && err.response?.status === 409) {
            // 409 Conflict: entry already exists, ignore
            return;
        }
        logger.debug(
            LogId.atlasIpAccessListAddFailure,
            "accessListUtils",
            `Error adding IP access list: ${err instanceof Error ? err.message : String(err)}`
        );
    }
}
