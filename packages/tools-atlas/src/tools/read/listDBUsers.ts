import { z } from "zod";
import { AtlasToolBase } from "../../atlasTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { AtlasArgs } from "../../args.js";

export const ListDBUsersArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID to filter DB users"),
};

const ListDBUsersOutputSchema = {
    projectId: z.string(),
    users: z.array(
        z.object({
            username: z.string(),
            roles: z.array(
                z.object({
                    roleName: z.string(),
                    databaseName: z.string(),
                    collectionName: z.string().optional(),
                })
            ),
            scopes: z.array(
                z.object({
                    type: z.enum(["CLUSTER", "DATA_LAKE", "STREAM"]),
                    name: z.string(),
                })
            ),
        })
    ),
    totalCount: z.number(),
};

export class ListDBUsersTool extends AtlasToolBase {
    static toolName = "atlas-list-db-users";
    public description = "List MongoDB Atlas database users";
    public static operationType: OperationType = "read";
    public argsShape = {
        ...ListDBUsersArgs,
    };
    public override outputSchema = ListDBUsersOutputSchema;

    protected async execute(
        { projectId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const data = await this.apiClient.listDatabaseUsers(
            {
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
            },
            context
        );

        if (!data?.results?.length) {
            return {
                content: [{ type: "text", text: " No database users found" }],
                structuredContent: {
                    projectId,
                    users: [],
                    totalCount: 0,
                },
            };
        }

        const users = data.results.map((user) => ({
            username: user.username,
            roles: (user.roles ?? []).map((role) => ({
                roleName: role.roleName,
                databaseName: role.databaseName,
                ...(role.collectionName !== undefined && { collectionName: role.collectionName }),
            })),
            scopes: (user.scopes ?? []).map((scope) => ({
                type: scope.type,
                name: scope.name,
            })),
        }));

        return {
            content: formatUntrustedData(
                `Found ${data.results.length} database users in project ${projectId}`,
                JSON.stringify(users)
            ),
            structuredContent: {
                projectId,
                users,
                totalCount: users.length,
            },
        };
    }
}
