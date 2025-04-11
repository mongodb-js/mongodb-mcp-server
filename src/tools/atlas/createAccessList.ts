import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "./atlasTool.js";
import { ToolArgs, OperationType } from "../tool.js";

const DEFAULT_COMMENT = "Added by Atlas MCP";

export class CreateAccessListTool extends AtlasToolBase {
    protected name = "atlas-create-access-list";
    protected description = "Allow Ip/CIDR ranges to access your MongoDB Atlas clusters.";
    protected operationType: OperationType = "create";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
        ipAddresses: z
            .array(z.string().ip({ version: "v4" }))
            .describe("IP addresses to allow access from")
            .optional(),
        cidrBlocks: z.array(z.string().cidr()).describe("CIDR blocks to allow access from").optional(),
        currentIpAddress: z.boolean().describe("Add the current IP address").default(false),
        comment: z.string().describe("Comment for the access list entries").default(DEFAULT_COMMENT).optional(),
    };

    protected async execute({
        projectId,
        ipAddresses,
        cidrBlocks,
        comment,
        currentIpAddress,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        this.session.ensureAuthenticated();

        if (!ipAddresses?.length && !cidrBlocks?.length && !currentIpAddress) {
            throw new Error("One of  ipAddresses, cidrBlocks, currentIpAddress must be provided.");
        }

        const ipInputs = (ipAddresses || []).map((ipAddress) => ({
            groupId: projectId,
            ipAddress,
            comment: comment || DEFAULT_COMMENT,
        }));

        if (currentIpAddress) {
            const currentIp = await this.session.apiClient.getIpInfo();
            const input = {
                groupId: projectId,
                ipAddress: currentIp.currentIpv4Address,
                comment: comment || DEFAULT_COMMENT,
            };
            ipInputs.push(input);
        }

        const cidrInputs = (cidrBlocks || []).map((cidrBlock) => ({
            groupId: projectId,
            cidrBlock,
            comment: comment || DEFAULT_COMMENT,
        }));

        const inputs = [...ipInputs, ...cidrInputs];

        await this.session.apiClient.createProjectIpAccessList({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: inputs,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `IP/CIDR ranges added to access list for project ${projectId}.`,
                },
            ],
        };
    }
}
