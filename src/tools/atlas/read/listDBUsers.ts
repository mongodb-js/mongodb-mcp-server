import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import type { DatabaseUserRole, UserScope } from "../../../common/atlas/openapi.js";

export class ListDBUsersTool extends AtlasToolBase {
    public name = "atlas-list-db-users";
    protected description = "List MongoDB Atlas database users";
    public operationType: OperationType = "read";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID to filter DB users"),
    };

    protected async execute({ projectId }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data = await this.session.apiClient.listDatabaseUsers({
            params: {
                path: {
                    groupId: projectId,
                },
            },
        });

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: " No database users found" }],
            };
        }

        const output =
            `Username | Roles | Scopes
----------------|----------------|----------------
` +
            data.results
                .map((user) => {
                    return `${user.username} | ${formatRoles(user.roles)} | ${formatScopes(user.scopes)}`;
                })
                .join("\n");
        return {
            content: formatUntrustedData(`Found ${data.results.length} database users in project ${projectId}`, output),
        };
    }
}

function formatRoles(roles?: DatabaseUserRole[]): string {
    if (!roles?.length) {
        return "N/A";
    }
    return roles
        .map(
            (role) =>
                `${role.roleName}${role.databaseName ? `@${role.databaseName}${role.collectionName ? `:${role.collectionName}` : ""}` : ""}`
        )
        .join(", ");
}

function formatScopes(scopes?: UserScope[]): string {
    if (!scopes?.length) {
        return "All";
    }
    return scopes.map((scope) => `${scope.type}:${scope.name}`).join(", ");
}
