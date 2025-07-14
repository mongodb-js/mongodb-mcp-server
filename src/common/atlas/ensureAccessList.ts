import { ApiClientError } from "./apiClientError.js";

/**
 * Ensures the current public IP is in the access list for the given Atlas project.
 * If the IP is already present, this is a no-op.
 * @param apiClient The Atlas API client instance
 * @param projectId The Atlas project ID
 */
export async function ensureCurrentIpInAccessList(apiClient: any, projectId: string): Promise<void> {
    // Get the current public IP
    const { currentIpv4Address } = await apiClient.getIpInfo();
    const entry = {
        groupId: projectId,
        ipAddress: currentIpv4Address,
        comment: "Added by MCP pre-run access list helper",
    };
    try {
        await apiClient.createProjectIpAccessList({
            params: { path: { groupId: projectId } },
            body: [entry],
        });
    } catch (err) {
        if (err instanceof ApiClientError && err.response?.status === 409) {
            // 409 Conflict: entry already exists, ignore
            return;
        }
        throw err;
    }
}
