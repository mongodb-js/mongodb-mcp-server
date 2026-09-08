import { z } from "zod";
import { type ToolArgs, type ToolResult, ToolArgumentValidationError } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { makeCurrentIpAccessListEntry, DEFAULT_ACCESS_LIST_COMMENT } from "../../helpers/accessListUtils.js";
import { AtlasArgs, CommonArgs } from "../../args.js";

// Atlas rejects access list entry comments longer than this.
const ACCESS_LIST_COMMENT_MAX_LENGTH = 80;

export const CreateAccessListArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    ipAddresses: z.array(AtlasArgs.ipAddress()).describe("IP addresses to allow access from").optional(),
    cidrBlocks: z.array(AtlasArgs.cidrBlock()).describe("CIDR blocks to allow access from").optional(),
    currentIpAddress: z.boolean().describe("Add the current IP address").default(false),
    comment: CommonArgs.asciiOnlyString()
        .max(ACCESS_LIST_COMMENT_MAX_LENGTH)
        .describe("Comment for the access list entries")
        .default(DEFAULT_ACCESS_LIST_COMMENT),
};

const CreateAccessListOutputSchema = {
    projectId: z.string(),
};

export class CreateAccessListTool extends AtlasToolBase {
    static toolName = "atlas-create-access-list";
    public description = "Allow Ip/CIDR ranges to access your MongoDB Atlas clusters.";
    static operationType: OperationType = "create";
    // The currentIpAddress arg is omitted on deployments that can't determine the
    // caller's public IP (e.g. the Atlas-hosted MCP server), so models are never
    // offered an option that cannot work there. Typed as the full shape because
    // execute() still receives currentIpAddress as optional either way.
    public get argsShape(): typeof CreateAccessListArgs {
        if (this.server.apiClient?.supportsCurrentIpLookup === false) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { currentIpAddress, ...rest } = CreateAccessListArgs;
            return rest as typeof CreateAccessListArgs;
        }

        return CreateAccessListArgs;
    }
    public override outputSchema = CreateAccessListOutputSchema;

    // argsShape drops currentIpAddress when IP lookup is unsupported, so the two
    // shapes must be cached and shared separately.
    protected override schemaVariantKey(): string {
        return this.server.apiClient?.supportsCurrentIpLookup === false ? "no-current-ip" : "current-ip";
    }

    protected async execute(
        { projectId, ipAddresses, cidrBlocks, comment, currentIpAddress }: ToolArgs<typeof this.argsShape>,
        { request }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        if (!ipAddresses?.length && !cidrBlocks?.length && !currentIpAddress) {
            if (!this.server.apiClient.supportsCurrentIpLookup) {
                throw new ToolArgumentValidationError("Either ipAddresses or cidrBlocks must be provided.");
            }

            throw new ToolArgumentValidationError("One of ipAddresses, cidrBlocks, currentIpAddress must be provided.");
        }

        const ipInputs = (ipAddresses || []).map((ipAddress) => ({
            groupId: projectId,
            ipAddress,
            comment: comment || DEFAULT_ACCESS_LIST_COMMENT,
        }));

        if (currentIpAddress) {
            const input = await makeCurrentIpAccessListEntry(
                this.server.apiClient,
                projectId,
                comment || DEFAULT_ACCESS_LIST_COMMENT
            );
            ipInputs.push(input);
        }

        const cidrInputs = (cidrBlocks || []).map((cidrBlock) => ({
            groupId: projectId,
            cidrBlock,
            comment: comment || DEFAULT_ACCESS_LIST_COMMENT,
        }));

        const inputs = [...ipInputs, ...cidrInputs];

        await this.server.apiClient.createAccessListEntry(
            {
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
                body: inputs,
            },
            request
        );

        return {
            content: [
                {
                    type: "text",
                    text: `IP/CIDR ranges added to access list for project ${projectId}.`,
                },
            ],
            structuredContent: {
                projectId,
            },
        };
    }

    protected getConfirmationMessage({
        projectId,
        ipAddresses,
        cidrBlocks,
        comment,
        currentIpAddress,
    }: ToolArgs<typeof this.argsShape>): string {
        const accessDescription = [];
        if (ipAddresses?.length) {
            accessDescription.push(`- **IP addresses**: ${ipAddresses.join(", ")}`);
        }
        if (cidrBlocks?.length) {
            accessDescription.push(`- **CIDR blocks**: ${cidrBlocks.join(", ")}`);
        }
        if (currentIpAddress) {
            accessDescription.push("- **Current IP address**");
        }

        return (
            `You are about to add the following entries to the access list for Atlas project "${projectId}":\n\n` +
            accessDescription.join("\n") +
            `\n\n**Comment**: ${comment || DEFAULT_ACCESS_LIST_COMMENT}\n\n` +
            "This will allow network access to your MongoDB Atlas clusters from these IP addresses/ranges. " +
            "Do you want to proceed?"
        );
    }
}
