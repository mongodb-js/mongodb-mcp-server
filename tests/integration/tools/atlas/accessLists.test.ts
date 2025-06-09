import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeWithAtlas, withProject } from "./atlasHelpers.js";
import { expectDefined } from "../../helpers.js";

function generateRandomIp() {
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
                expect(response.content).toBeArray();
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
                expect(response.content).toBeArray();
                expect(response.content).toHaveLength(1);
                for (const value of values) {
                    expect(response.content[0]?.text).toContain(value);
                }
            });
        });
    });
});
