import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { ensureCurrentIpInAccessList, DEFAULT_ACCESS_LIST_COMMENT } from "../../src/common/atlas/accessListUtils.js";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import { NoopLogger } from "@mongodb-js/mcp-core";

describe("accessListUtils", () => {
    it("should add the current IP to the access list", async () => {
        const apiClient = {
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createAccessListEntry: vi.fn().mockResolvedValue(undefined as never),
            logger: new NoopLogger(),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
        });
    });

    it("should not fail if the current IP is already in the access list", async () => {
        const apiClient = {
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createAccessListEntry: vi.fn().mockRejectedValue(
                ApiClientError.fromError({
                    response: { status: 409, statusText: "Conflict" } as Response,
                    error: { message: "Conflict" } as never,
                }) as never
            ),
            logger: new NoopLogger(),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
        });
    });
});
