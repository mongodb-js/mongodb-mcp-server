import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class DbStatsTool extends MongoDBToolBase {
    protected name = "db-stats";
    protected description = "Returns statistics that reflect the use state of a single database";
    protected argsShape = {
        database: DbOperationArgs.database,
    };

    protected operationType: OperationType = "metadata";

    protected async execute({ database }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const result = await provider.runCommandWithCheck(database, {
            dbStats: 1,
            scale: 1,
        });

        return {
            content: [
                {
                    text: `Statistics for database ${database}: ${JSON.stringify(result)}`,
                    type: "text",
                },
            ],
        };
    }
}
