import { type ApiClient, type ApiClientRequestContext } from "./apiClient.js";
import { requestIdAttr } from "../../helpers/requestIdAttr.js";
import { LogId } from "../logging/index.js";
import { ApiClientError } from "./apiClientError.js";

export const DEFAULT_ACCESS_LIST_COMMENT = "Added by MongoDB MCP Server to enable tool access";

/**
 * Note appended to tool results when the current public IP was added to the
 * project's IP access list as part of the tool's execution.
 */
export const ACCESS_LIST_ADDED_NOTE =
    "Note: Your current IP address has been added to the Atlas project's IP access list to enable secure connection.";

/**
 * Note appended to tool results when automatic IP access list setup was skipped
 * because the deployment cannot determine the caller's public IP address.
 */
export const ACCESS_LIST_SKIPPED_NOTE =
    "No IP access list changes were made because this server cannot determine your public IP address. " +
    "To connect from your own machine, add its public IP address to the project's IP access list — " +
    "for example with the atlas-create-access-list tool or through the Atlas UI.";

/**
 * Note appended to tool results when the attempt to add the current public IP
 * to the project's IP access list failed (IP lookup or entry creation error).
 */
export const ACCESS_LIST_FAILED_NOTE =
    "No IP access list changes were made because the attempt to add your current IP address " +
    "to the project's IP access list did not succeed. To connect from your own machine, " +
    "retry with the atlas-create-access-list tool or add your IP through the Atlas UI.";

/**
 * Maps an {@link EnsureCurrentIpResult} to the note a tool should append to its
 * result, or `undefined` when there is nothing worth reporting (the current IP
 * can already connect).
 */
export function getAccessListNote(result: EnsureCurrentIpResult): string | undefined {
    switch (result) {
        case "added":
            return ACCESS_LIST_ADDED_NOTE;
        case "already-present":
            return undefined;
        case "skipped":
            return ACCESS_LIST_SKIPPED_NOTE;
        case "failed":
            return ACCESS_LIST_FAILED_NOTE;
    }
}

export async function makeCurrentIpAccessListEntry(
    apiClient: ApiClient,
    projectId: string,
    comment: string = DEFAULT_ACCESS_LIST_COMMENT
): Promise<{ groupId: string; ipAddress: string; comment: string }> {
    const { currentIpv4Address } = await apiClient.getIpInfo();
    return {
        groupId: projectId,
        ipAddress: currentIpv4Address,
        comment,
    };
}

/**
 * Outcome of {@link ensureCurrentIpInAccessList}:
 * - `added` - a new access list entry was created for the current IP
 * - `already-present` - the current IP was already in the access list
 * - `skipped` - the deployment does not support current IP detection
 * - `failed` - the IP could not be determined or the entry could not be created
 */
export type EnsureCurrentIpResult = "added" | "already-present" | "skipped" | "failed";

/**
 * Ensures the current public IP is in the access list for the given Atlas project.
 * If the IP is already present, this is a no-op. Never throws - failures are
 * reported through the returned {@link EnsureCurrentIpResult}.
 * @param apiClient The Atlas API client instance
 * @param projectId The Atlas project ID
 */
export async function ensureCurrentIpInAccessList(
    apiClient: ApiClient,
    projectId: string,
    context?: ApiClientRequestContext
): Promise<EnsureCurrentIpResult> {
    if (!apiClient.supportsCurrentIpLookup) {
        apiClient.logger.debug({
            id: LogId.atlasIpAccessListAddFailure,
            context: "accessListUtils",
            message: `Skipping IP access list setup for project ${projectId}: this deployment does not support current IP detection.`,
            attributes: { ...requestIdAttr(context?.requestInfo?.headers) },
        });

        return "skipped";
    }

    let entry: { groupId: string; ipAddress: string; comment: string } | undefined;
    try {
        entry = await makeCurrentIpAccessListEntry(apiClient, projectId, DEFAULT_ACCESS_LIST_COMMENT);
        await apiClient.createAccessListEntry(
            {
                params: { path: { groupId: projectId } },
                body: [entry],
            },
            context
        );
        apiClient.logger.debug({
            id: LogId.atlasIpAccessListAdded,
            context: "accessListUtils",
            message: `IP access list created: ${JSON.stringify(entry)}`,
            attributes: { ...requestIdAttr(context?.requestInfo?.headers) },
        });
        return "added";
    } catch (err) {
        if (entry && err instanceof ApiClientError && err.response?.status === 409) {
            // 409 Conflict: entry already exists, log info
            apiClient.logger.debug({
                id: LogId.atlasIpAccessListAdded,
                context: "accessListUtils",
                message: `IP address ${entry.ipAddress} is already present in the access list for project ${projectId}.`,
                attributes: { ...requestIdAttr(context?.requestInfo?.headers) },
            });

            return "already-present";
        }

        apiClient.logger.warning({
            id: LogId.atlasIpAccessListAddFailure,
            context: "accessListUtils",
            message: `Error adding IP access list: ${err instanceof Error ? err.message : String(err)}`,
            attributes: { ...requestIdAttr(context?.requestInfo?.headers) },
        });
    }

    return "failed";
}
