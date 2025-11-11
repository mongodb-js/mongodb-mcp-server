import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export class ListOrganizationsTool extends AtlasToolBase {
    public name = "atlas-list-orgs";
    protected description = "List MongoDB Atlas organizations";
    public operationType: OperationType = "read";
    protected argsShape = {};

    protected async execute(): Promise<CallToolResult> {
        const data = await this.session.apiClient.listOrgs();

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
            };
        }

        const orgs = data.results.map((org) => ({
            name: org.name,
            id: org.id,
        }));

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} organizations in your MongoDB Atlas account.`,
                JSON.stringify(orgs)
            ),
        };
    }
}
