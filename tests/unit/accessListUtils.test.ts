import { describe, it, expect, vi } from "vitest";
import { ApiClient } from "../../src/common/atlas/apiClient.js";
import { ensureCurrentIpInAccessList, DEFAULT_ACCESS_LIST_COMMENT } from "../../src/common/atlas/accessListUtils.js";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";
import { NullLogger } from "../../src/common/logger.js";

describe("accessListUtils", () => {
    it("should add the current IP to the access list", async () => {
        const apiClient = {
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createProjectIpAccessList: vi.fn().mockResolvedValue(undefined as never),
            logger: new NullLogger(),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createProjectIpAccessList).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
        });
    });

    it("should not fail if the current IP is already in the access list", async () => {
        const apiClient = {
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createProjectIpAccessList: vi
                .fn()
                .mockRejectedValue(
                    ApiClientError.fromError(
                        { status: 409, statusText: "Conflict" } as Response,
                        { message: "Conflict" } as never
                    ) as never
                ),
            logger: new NullLogger(),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createProjectIpAccessList).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
        });
    });
});
