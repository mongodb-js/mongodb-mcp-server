import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "./atlasTool.js";
import { ToolArgs, OperationType } from "../tool.js";
import { CloudDatabaseUser, DatabaseUserRole } from "../../common/atlas/openapi.js";

export class CreateDBUserTool extends AtlasToolBase {
    protected name = "atlas-create-db-user";
    protected description = "Create an MongoDB Atlas database user";
    protected operationType: OperationType = "create";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID"),
        username: z.string().describe("Username for the new user"),
        password: z.string().describe("Password for the new user"),
        roles: z
            .array(
                z.object({
                    roleName: z.string().describe("Role name"),
                    databaseName: z.string().describe("Database name").default("admin"),
                    collectionName: z.string().describe("Collection name").optional(),
                })
            )
            .describe("Roles for the new user"),
        clusters: z
            .array(z.string())
            .describe("Clusters to assign the user to, leave empty for access to all clusters")
            .optional(),
    };

    protected async execute({
        projectId,
        username,
        password,
        roles,
        clusters,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        this.session.ensureAuthenticated();

        const input = {
            groupId: projectId,
            awsIAMType: "NONE",
            databaseName: "admin",
            ldapAuthType: "NONE",
            oidcAuthType: "NONE",
            x509Type: "NONE",
            username,
            password,
            roles: roles as unknown as DatabaseUserRole[],
            scopes: clusters?.length
                ? clusters.map((cluster) => ({
                      type: "CLUSTER",
                      name: cluster,
                  }))
                : undefined,
        } as CloudDatabaseUser;

        await this.session.apiClient.createDatabaseUser({
            params: {
                path: {
                    groupId: projectId,
                },
            },
            body: input,
        });

        return {
            content: [{ type: "text", text: `User "${username}" created sucessfully.` }],
        };
    }
}
