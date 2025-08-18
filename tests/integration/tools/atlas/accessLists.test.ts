import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeWithAtlas, withProject } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureCurrentIpInAccessList } from "../../../../src/common/atlas/accessListUtils.js";

function generateRandomIp(): string {
    const randomIp: number[] = [192];
    for (let i = 0; i < 3; i++) {
        randomIp.push(Math.floor(Math.random() * 256));
    }
    return randomIp.join(".");
}

describeWithAtlas("ip access lists", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        const ips = [generateRandomIp(), generateRandomIp()];
        const cidrBlocks = [generateRandomIp() + "/16", generateRandomIp() + "/24"];
        const values = [...ips, ...cidrBlocks];

        beforeAll(async () => {
            const apiClient = integration.mcpServer().session.apiClient;
            const ipInfo = await apiClient.getIpInfo();
            values.push(ipInfo.currentIpv4Address);
        });

        afterAll(async () => {
            const apiClient = integration.mcpServer().session.apiClient;

            const projectId = getProjectId();

            for (const value of values) {
                await apiClient.deleteProjectIpAccessList({
                    params: {
                        path: {
                            groupId: projectId,
                            entryValue: value,
                        },
                    },
                });
            }
        });

        describe("atlas-create-access-list", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const createAccessList = tools.find((tool) => tool.name === "atlas-create-access-list");
                expectDefined(createAccessList);
                expect(createAccessList.inputSchema.type).toBe("object");
                expectDefined(createAccessList.inputSchema.properties);
                expect(createAccessList.inputSchema.properties).toHaveProperty("projectId");
                expect(createAccessList.inputSchema.properties).toHaveProperty("ipAddresses");
                expect(createAccessList.inputSchema.properties).toHaveProperty("cidrBlocks");
                expect(createAccessList.inputSchema.properties).toHaveProperty("currentIpAddress");
                expect(createAccessList.inputSchema.properties).toHaveProperty("comment");
            });

            it("should create an access list", async () => {
                const projectId = getProjectId();

                const response = (await integration.mcpClient().callTool({
                    name: "atlas-create-access-list",
                    arguments: {
                        projectId,
                        ipAddresses: ips,
                        cidrBlocks: cidrBlocks,
                        currentIpAddress: true,
                    },
                })) as CallToolResult;
                expect(response.content).toBeInstanceOf(Array);
                expect(response.content).toHaveLength(1);
                expect(response.content[0]?.text).toContain("IP/CIDR ranges added to access list");
            });
        });

        describe("atlas-inspect-access-list", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const inspectAccessList = tools.find((tool) => tool.name === "atlas-inspect-access-list");
                expectDefined(inspectAccessList);
                expect(inspectAccessList.inputSchema.type).toBe("object");
                expectDefined(inspectAccessList.inputSchema.properties);
                expect(inspectAccessList.inputSchema.properties).toHaveProperty("projectId");
            });

            it("returns access list data", async () => {
                const projectId = getProjectId();

                const response = (await integration
                    .mcpClient()
                    .callTool({ name: "atlas-inspect-access-list", arguments: { projectId } })) as CallToolResult;
                expect(response.content).toBeInstanceOf(Array);
                expect(response.content).toHaveLength(1);
                for (const value of values) {
                    expect(response.content[0]?.text).toContain(value);
                }
            });
        });

        describe("ensureCurrentIpInAccessList helper", () => {
            it("should add the current IP to the access list and be idempotent", async () => {
                const apiClient = integration.mcpServer().session.apiClient;
                const projectId = getProjectId();
                const ipInfo = await apiClient.getIpInfo();
                // First call should add the IP
                await expect(ensureCurrentIpInAccessList(apiClient, projectId)).resolves.not.toThrow();
                // Second call should be a no-op (idempotent)
                await expect(ensureCurrentIpInAccessList(apiClient, projectId)).resolves.not.toThrow();
                // Check that the IP is present in the access list
                const accessList = await apiClient.listProjectIpAccessLists({
                    params: { path: { groupId: projectId } },
                });
                const found = accessList.results?.some((entry) => entry.ipAddress === ipInfo.currentIpv4Address);
                expect(found).toBe(true);
            });
        });
    });
});
