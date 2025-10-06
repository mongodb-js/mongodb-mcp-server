import {
    ToolBase,
    type TelemetryToolMetadata,
    type ToolArgs,
    type ToolCategory,
    type ToolConstructorParams,
} from "../tool.js";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { Server } from "../../server.js";
import { packageInfo } from "../../common/packageInfo.js";
import { formatUntrustedData } from "../tool.js";

export abstract class AssistantToolBase extends ToolBase {
    protected server?: Server;
    public category: ToolCategory = "assistant";
    protected baseUrl: URL;
    protected requiredHeaders: Headers;

    constructor({ session, config, telemetry, elicitation }: ToolConstructorParams) {
        super({ session, config, telemetry, elicitation });
        this.baseUrl = new URL(config.assistantBaseUrl);
        this.requiredHeaders = new Headers({
            "x-request-origin": "mongodb-mcp-server",
            "user-agent": packageInfo.version ? `mongodb-mcp-server/v${packageInfo.version}` : "mongodb-mcp-server",
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

        // Use the same custom fetch implementation as the Atlas API client.
        // We need this to support enterprise proxies.
        const customFetch = createFetch({
            useEnvironmentVariableProxies: true,
        }) as unknown as typeof fetch;

        return await customFetch(endpoint, {
            method: args.method,
            headers,
            body: JSON.stringify(args.body),
        });
    }
}
