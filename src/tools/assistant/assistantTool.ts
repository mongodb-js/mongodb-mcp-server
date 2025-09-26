import { TelemetryToolMetadata, ToolArgs, ToolBase, ToolCategory } from "../tool.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "../../server.js";
import { Session } from "../../common/session.js";
import { UserConfig } from "../../common/config.js";
import { Telemetry } from "../../telemetry/telemetry.js";
import { packageInfo } from "../../common/packageInfo.js";

export abstract class AssistantToolBase extends ToolBase {
    protected server?: Server;
    public category: ToolCategory = "assistant";
    protected baseUrl: URL;
    protected requiredHeaders: Record<string, string>;

    constructor(
        protected readonly session: Session,
        protected readonly config: UserConfig,
        protected readonly telemetry: Telemetry
    ) {
        super(session, config, telemetry);
        this.baseUrl = new URL(config.assistantBaseUrl);
        const serverVersion = packageInfo.version;
        this.requiredHeaders = {
            "x-request-origin": "mongodb-mcp-server",
            "user-agent": serverVersion ? `mongodb-mcp-server/v${serverVersion}` : "mongodb-mcp-server",
        };
    }

    public register(server: Server): boolean {
        this.server = server;
        return super.register(server);
    }

    protected resolveTelemetryMetadata(_args: ToolArgs<typeof this.argsShape>): TelemetryToolMetadata {
        // Assistant tool calls are not associated with a specific project or organization
        // Therefore, we don't have any values to add to the telemetry metadata
        return {};
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        return super.handleError(error, args);
    }
}
