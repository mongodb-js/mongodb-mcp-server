import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "../../src/common/atlas/apiClient.js";
import { ensureCurrentIpInAccessList, DEFAULT_ACCESS_LIST_COMMENT } from "../../src/common/atlas/accessListUtils.js";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";
import { NullLogger } from "../../src/common/logging/index.js";
import type { LoggerBase } from "../../src/common/logging/loggerBase.js";

describe("accessListUtils", () => {
    it("should add the current IP to the access list", async () => {
        const apiClient = {
            supportsCurrentIpLookup: true,
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createAccessListEntry: vi.fn().mockResolvedValue(undefined as never),
            logger: new NullLogger(),
        } as unknown as ApiClient;
        await expect(ensureCurrentIpInAccessList(apiClient, "projectId")).resolves.toBe("added");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).toHaveBeenCalledWith(
            {
                params: { path: { groupId: "projectId" } },
                body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
            },
            undefined
        );
    });

    it("should not fail if the current IP is already in the access list", async () => {
        const apiClient = {
            supportsCurrentIpLookup: true,
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" } as never),
            createAccessListEntry: vi
                .fn()
                .mockRejectedValue(
                    ApiClientError.fromError(
                        { status: 409, statusText: "Conflict" } as Response,
                        { message: "Conflict" } as never
                    ) as never
                ),
            logger: new NullLogger(),
        } as unknown as ApiClient;
        await expect(ensureCurrentIpInAccessList(apiClient, "projectId")).resolves.toBe("already-present");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).toHaveBeenCalledWith(
            {
                params: { path: { groupId: "projectId" } },
                body: [{ groupId: "projectId", ipAddress: "127.0.0.1", comment: DEFAULT_ACCESS_LIST_COMMENT }],
            },
            undefined
        );
    });

    it("does not fail when the current IP cannot be determined", async () => {
        const logger = { debug: vi.fn(), warning: vi.fn() } as unknown as LoggerBase;
        const apiClient = {
            supportsCurrentIpLookup: true,
            getIpInfo: vi
                .fn()
                .mockRejectedValue(
                    ApiClientError.fromError(
                        { status: 404, statusText: "Not Found" } as Response,
                        { message: "Not Found" } as never
                    ) as never
                ),
            createAccessListEntry: vi.fn(),
            logger,
        } as unknown as ApiClient;
        await expect(ensureCurrentIpInAccessList(apiClient, "projectId")).resolves.toBe("failed");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).not.toHaveBeenCalled();
        expect((logger as unknown as { warning: ReturnType<typeof vi.fn> }).warning).toHaveBeenCalled();
    });

    it("skips the IP lookup entirely when the api client does not support it", async () => {
        const apiClient = {
            supportsCurrentIpLookup: false,
            getIpInfo: vi.fn(),
            createAccessListEntry: vi.fn(),
            logger: new NullLogger(),
        } as unknown as ApiClient;
        await expect(ensureCurrentIpInAccessList(apiClient, "projectId")).resolves.toBe("skipped");
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.getIpInfo).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(apiClient.createAccessListEntry).not.toHaveBeenCalled();
    });

    const context = { requestInfo: { headers: { "x-request-id": "req-access-1" } } };

    function makeSpyApiClient(createResult: "resolve" | "conflict" | "error"): ApiClient & {
        logger: { debug: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };
    } {
        const logger = { debug: vi.fn(), warning: vi.fn() } as unknown as LoggerBase;
        let createMock: ReturnType<typeof vi.fn>;
        if (createResult === "resolve") {
            createMock = vi.fn().mockResolvedValue(undefined);
        } else if (createResult === "conflict") {
            createMock = vi.fn().mockRejectedValue(
                ApiClientError.fromError(
                    { status: 409, statusText: "Conflict" } as Response,
                    {
                        message: "Conflict",
                    } as never
                )
            );
        } else {
            createMock = vi.fn().mockRejectedValue(new Error("network error"));
        }
        return {
            supportsCurrentIpLookup: true,
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "1.2.3.4" }),
            createAccessListEntry: createMock,
            logger,
        } as unknown as ApiClient & { logger: { debug: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> } };
    }

    it("includes x-request-id in debug log when IP is added", async () => {
        const apiClient = makeSpyApiClient("resolve");
        await ensureCurrentIpInAccessList(apiClient, "proj1", context);
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                attributes: expect.objectContaining({ "x-request-id": "req-access-1" }),
            })
        );
    });

    it("includes x-request-id in debug log when IP is already present (409)", async () => {
        const apiClient = makeSpyApiClient("conflict");
        await ensureCurrentIpInAccessList(apiClient, "proj1", context);
        expect(apiClient.logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                attributes: expect.objectContaining({ "x-request-id": "req-access-1" }),
            })
        );
    });

    it("includes x-request-id in warning log when add fails with non-409 error", async () => {
        const apiClient = makeSpyApiClient("error");
        await ensureCurrentIpInAccessList(apiClient, "proj1", context);
        expect(apiClient.logger.warning).toHaveBeenCalledWith(
            expect.objectContaining({
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                attributes: expect.objectContaining({ "x-request-id": "req-access-1" }),
            })
        );
    });
});
