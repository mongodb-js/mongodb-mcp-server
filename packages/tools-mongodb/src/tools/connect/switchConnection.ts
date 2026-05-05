import { z } from "zod";
import { MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";

export class SwitchConnectionTool extends MongoDBToolBase {
    static toolName = "switch-connection";
    public description = "Switch to a different MongoDB connection by providing a new connection string";
    public argsShape = {
        connectionString: z.string().describe("The new MongoDB connection string to switch to"),
    };
    static operationType: OperationType = "connect";

    protected async execute({
        connectionString,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult> {
        // First disconnect from current connection
        await this.session.connectionManager.disconnect();

        // Connect to the new connection string
        await this.session.connectToMongoDB({ connectionString });

        return {
            content: [
                {
                    text: `Successfully switched to new MongoDB connection.`,
                    type: "text",
                },
            ],
        };
    }
}
