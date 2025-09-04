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
        const data = await this.session.apiClient.listOrganizations();

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: "No organizations found in your MongoDB Atlas account." }],
            };
        }

        // Format organizations as a table
        const output =
            `Organization Name | Organization ID
----------------| ----------------
` +
            data.results
                .map((org) => {
                    return `${org.name} | ${org.id}`;
                })
                .join("\n");
        return {
            content: formatUntrustedData(
                `Found ${data.results.length} organizations in your MongoDB Atlas account.`,
                output
            ),
        };
    }
}
