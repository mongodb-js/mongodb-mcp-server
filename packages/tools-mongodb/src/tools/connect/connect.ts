import { z } from "zod";
import { MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";
import type { ConnectionSettings } from "../../connection/connectionManager.js";

export class ConnectTool extends MongoDBToolBase {
    static toolName = "connect";
    public description = "Connect to a MongoDB instance using a connection string";
    public argsShape = {
        connectionString: z.string().describe("The MongoDB connection string to connect with"),
    };
    static operationType: OperationType = "connect";

    protected async execute({ connectionString }: ToolArgs<typeof this.argsShape>): Promise<ToolResult> {
        const settings: ConnectionSettings = {
            connectionString,
        };

        await this.session.connectToMongoDB(settings);

        return {
            content: [
                {
                    text: "Successfully connected to MongoDB.",
                    type: "text",
                },
            ],
        };
    }
}
