import { z } from "zod";
import { ToolBase, ToolCategory } from "../tool.js";
import { Session } from "../../session.js";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, MongoDBError } from "../../errors.js";
import config from "../../config.js";

export const DbOperationArgs = {
    database: z.string().describe("Database name"),
    collection: z.string().describe("Collection name"),
};

export abstract class MongoDBToolBase extends ToolBase {
    constructor(session: Session) {
        super(session);
    }

    protected category: ToolCategory = "mongodb";

    protected async ensureConnected(): Promise<NodeDriverServiceProvider> {
        const provider = this.session.serviceProvider;
        if (!provider && config.connectionString) {
            await this.connectToMongoDB(config.connectionString);
        }

        if (!provider) {
            throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
        }

        return provider;
    }

    protected handleError(error: unknown): Promise<CallToolResult> | CallToolResult {
        if (error instanceof MongoDBError && error.code === ErrorCodes.NotConnectedToMongoDB) {
            return {
                content: [
                    {
                        type: "text",
                        text: "You need to connect to a MongoDB instance before you can access its data.",
                    },
                    {
                        type: "text",
                        text: "Please use the 'connect' tool to connect to a MongoDB instance.",
                    },
                ],
                isError: true,
            };
        }

        return super.handleError(error);
    }

    protected async connectToMongoDB(connectionString: string): Promise<void> {
        const provider = await NodeDriverServiceProvider.connect(connectionString, {
            productDocsLink: "https://docs.mongodb.com/todo-mcp",
            productName: "MongoDB MCP",
            readConcern: {
                level: config.connectOptions.readConcern,
            },
            readPreference: config.connectOptions.readPreference,
            writeConcern: {
                w: config.connectOptions.writeConcern,
            },
            timeoutMS: config.connectOptions.timeoutMS,
        });

        this.session.serviceProvider = provider;
    }
}
