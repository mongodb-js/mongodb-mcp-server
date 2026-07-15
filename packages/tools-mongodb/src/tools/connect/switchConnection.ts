import z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolConstructorParams, ToolResult } from "../../tool.js";
import type { Server } from "../../../server.js";

const SwitchConnectionOutputSchema = {
    connected: z.boolean(),
};

export class SwitchConnectionTool extends MongoDBToolBase {
    static toolName = "switch-connection";
    public override description =
        "Switch to a different MongoDB connection. If the user has configured a connection string or has previously called the connect tool, a connection is already established and there's no need to call this tool unless the user has explicitly requested to switch to a new instance.";

    public override argsShape = {
        connectionString: z
            .string()
            .optional()
            .describe(
                "MongoDB connection string to switch to (in the mongodb:// or mongodb+srv:// format). If a connection string is not provided, the connection string from the config will be used."
            ),
    };

    static operationType: OperationType = "connect";

    public override outputSchema = SwitchConnectionOutputSchema;

    constructor(params: ToolConstructorParams) {
        super(params);
        params.session.on("connect", () => {
            this.enable();
        });

        params.session.on("disconnect", () => {
            this.disable();
        });
    }

    public override register(server: Server): boolean {
        const registrationSuccessful = super.register(server);
        /**
         * When connected to mongodb we want to swap connect with
         * switch-connection tool.
         */
        if (registrationSuccessful && !this.session.isConnectedToMongoDB) {
            this.disable();
        }
        return registrationSuccessful;
    }

    protected override async execute({
        connectionString,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        if (typeof connectionString !== "string") {
            await this.session.connectToConfiguredConnection();
        } else {
            await this.session.connectToMongoDB({ connectionString });
        }

        return {
            content: [{ type: "text", text: "Successfully connected to MongoDB." }],
            structuredContent: { connected: true },
        };
    }

    protected override async handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        const result = await super.handleError(error, args);
        if (result.isError) {
            return { ...result, structuredContent: { connected: false } };
        }
        return result;
    }
}
