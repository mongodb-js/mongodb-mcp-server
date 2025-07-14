import { ensureCurrentIpInAccessList } from "../../src/common/atlas/ensureAccessList.js";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";

describe("ensureCurrentIpInAccessList", () => {
    const projectId = "test-project-id";
    const ip = "1.2.3.4";
    let apiClient: any;

    beforeEach(() => {
        apiClient = {
            getIpInfo: jest.fn().mockResolvedValue({ currentIpv4Address: ip }),
            createProjectIpAccessList: jest.fn().mockResolvedValue(undefined),
        };
    });

    it("adds the current IP to the access list", async () => {
        await expect(ensureCurrentIpInAccessList(apiClient, projectId)).resolves.not.toThrow();
        expect(apiClient.getIpInfo).toHaveBeenCalled();
        expect(apiClient.createProjectIpAccessList).toHaveBeenCalledWith({
            params: { path: { groupId: projectId } },
            body: [
                {
                    groupId: projectId,
                    ipAddress: ip,
                    comment: expect.any(String),
                },
            ],
        });
    });

    it("is idempotent if the IP is already present (409 error)", async () => {
        apiClient.createProjectIpAccessList.mockRejectedValueOnce(
            Object.assign(new ApiClientError("Conflict", { status: 409, statusText: "Conflict" } as any), {
                response: { status: 409 },
            })
        );
        await expect(ensureCurrentIpInAccessList(apiClient, projectId)).resolves.not.toThrow();
    });

    it("throws for other errors", async () => {
        apiClient.createProjectIpAccessList.mockRejectedValueOnce(
            Object.assign(new ApiClientError("Other", { status: 500, statusText: "Server Error" } as any), {
                response: { status: 500 },
            })
        );
        await expect(ensureCurrentIpInAccessList(apiClient, projectId)).rejects.toThrow();
    });
});
