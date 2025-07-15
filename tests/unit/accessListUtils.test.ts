/* global jest */
import { ApiClient } from "../../src/common/atlas/apiClient.js";
import { ensureCurrentIpInAccessList } from "../../src/common/atlas/accessListUtils.js";
import { jest } from "@jest/globals";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";

describe("accessListUtils", () => {
    it("should add the current IP to the access list", async () => {
        const apiClient = {
            getIpInfo: jest.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createProjectIpAccessList: jest.fn().mockResolvedValue(undefined as never),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        expect(apiClient.createProjectIpAccessList).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [
                { groupId: "projectId", ipAddress: "127.0.0.1", comment: "Added by MCP pre-run access list helper" },
            ],
        });
    });

    it("should not fail if the current IP is already in the access list", async () => {
        const apiClient = {
            getIpInfo: jest.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createProjectIpAccessList: jest
                .fn()
                .mockRejectedValue(
                    ApiClientError.fromError(
                        { status: 409, statusText: "Conflict" } as Response,
                        { message: "Conflict" } as never
                    ) as never
                ),
        } as unknown as ApiClient;
        await ensureCurrentIpInAccessList(apiClient, "projectId");
        expect(apiClient.createProjectIpAccessList).toHaveBeenCalledWith({
            params: { path: { groupId: "projectId" } },
            body: [
                { groupId: "projectId", ipAddress: "127.0.0.1", comment: "Added by MCP pre-run access list helper" },
            ],
        });
    });
});
