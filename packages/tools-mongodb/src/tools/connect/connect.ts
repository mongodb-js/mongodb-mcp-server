import { z } from "zod";
import { MongoDBToolBase, type IMongoDBSession, type MongoDBToolRegistrationServer } from "../../mongodbTool.js";
import type { ToolArgs, ToolConstructorParams, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";

const ConnectOutputSchema = {
    connected: z.boolean(),
};

export class ConnectTool extends MongoDBToolBase {
    static toolName = "connect";
    public override description =
        "Connect to a MongoDB instance. The config resource captures if the server is already connected to a MongoDB cluster. If the user has configured a connection string or has previously called the connect tool, a connection is already established and there's no need to call this tool unless the user has explicitly requested to switch to a new MongoDB cluster.";

    // Here the default is empty just to trigger registration, but we're going to override it with the correct
    // schema in the register method.
    public override argsShape = {
        connectionString: z.string().describe("MongoDB connection string (in the mongodb:// or mongodb+srv:// format)"),
    };

    static operationType: OperationType = "connect";

    public override outputSchema = ConnectOutputSchema;

    constructor(params: ToolConstructorParams<IMongoDBSession>) {
        super(params);
        this.session.on("connect", () => {
            this.disable();
        });

        this.session.on("disconnect", () => {
            this.enable();
        });
    }

    public override register(server: MongoDBToolRegistrationServer): boolean {
        const registrationSuccessful = super.register(server);
        /**
         * When connected to mongodb we want to swap connect with
         * switch-connection tool.
         */
        if (registrationSuccessful && this.session.isConnectedToMongoDB) {
            this.disable();
        }
        return registrationSuccessful;
    }

    protected override async execute({
        connectionString,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        await this.session.connectToMongoDB({ connectionString });

        return {
            content: [{ type: "text", text: "Successfully connected to MongoDB." }],
            structuredContent: { connected: true },
        };
    }
}
