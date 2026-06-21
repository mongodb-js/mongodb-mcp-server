import { z } from "zod";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolConstructorParams, ToolResult } from "../../tool.js";
import type { Server } from "../../../server.js";
import { waitForConnectResult } from "../../../common/waitForConnectResult.js";
import { oidcDeviceFlowMessage } from "../../../common/oidcDeviceFlowMessage.js";

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

    constructor(params: ToolConstructorParams) {
        super(params);
        params.session.on("connect", () => {
            this.disable();
        });

        params.session.on("disconnect", () => {
            this.enable();
        });
    }

    public override register(server: Server): boolean {
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

        const connectionManager = this.session.connectionManager;

        // For OIDC, `connectToMongoDB` resolves while still in the `connecting`
        // state — before the device-flow callback has populated the verification
        // URL and user code. Wait for the attempt to make progress so we can
        // surface those to the user directly, instead of reporting success and
        // having the next data operation fail asking them to authenticate.
        if (connectionManager.currentConnectionState.tag === "connecting") {
            const result = await waitForConnectResult({
                events: connectionManager.events,
                getCurrentState: () => connectionManager.currentConnectionState,
            });

            if (result.kind === "device-flow") {
                return {
                    content: [{ type: "text", text: oidcDeviceFlowMessage(result.oidcLoginUrl, result.oidcUserCode) }],
                    structuredContent: { connected: false },
                };
            }
        }

        return {
            content: [{ type: "text", text: "Successfully connected to MongoDB." }],
            structuredContent: { connected: true },
        };
    }
}
