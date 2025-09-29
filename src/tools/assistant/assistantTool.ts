import {
    ToolBase,
    type TelemetryToolMetadata,
    type ToolArgs,
    type ToolCategory,
    type ToolConstructorParams,
} from "../tool.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "../../server.js";
import { packageInfo } from "../../common/packageInfo.js";

export abstract class AssistantToolBase extends ToolBase {
    protected server?: Server;
    public category: ToolCategory = "assistant";
    protected baseUrl: URL;
    protected requiredHeaders: Headers;

    constructor({ session, config, telemetry, elicitation }: ToolConstructorParams) {
        super({ session, config, telemetry, elicitation });
        this.baseUrl = new URL(config.assistantBaseUrl);
        const serverVersion = packageInfo.version;
        this.requiredHeaders = new Headers({
            "x-request-origin": "mongodb-mcp-server",
            "user-agent": serverVersion ? `mongodb-mcp-server/v${serverVersion}` : "mongodb-mcp-server",
        });
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

    protected async callAssistantApi(args: { method: "GET" | "POST"; endpoint: string; body?: unknown }) {
        const endpoint = new URL(args.endpoint, this.baseUrl);
        const headers = new Headers(this.requiredHeaders);
        if (args.method === "POST") {
            headers.set("Content-Type", "application/json");
        }
        return await fetch(endpoint, {
            method: args.method,
            headers,
            body: JSON.stringify(args.body),
        });
    }
}
