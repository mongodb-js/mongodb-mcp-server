import { ToolBase } from "@mongodb-js/mcp-core";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import type { TelemetryToolMetadata, IToolConfig, ToolCategory } from "@mongodb-js/mcp-types";
import { createFetch } from "@mongodb-js/devtools-proxy-support";

export const DEFAULT_ASSISTANT_BASE_URL = "https://knowledge.mongodb.com/api/v1/";

export interface IAssistantConfig extends IToolConfig {
    assistantBaseUrl?: string;
    serverVersion?: string;
}

export abstract class AssistantToolBase extends ToolBase<IAssistantConfig> {
    static category: ToolCategory = "assistant";

    protected baseUrl: URL;
    protected requiredHeaders: Headers;

    constructor(params: ToolConstructorParams<IAssistantConfig>) {
        super(params);
        this.baseUrl = new URL(params.config.assistantBaseUrl ?? DEFAULT_ASSISTANT_BASE_URL);
        this.requiredHeaders = new Headers({
            "x-request-origin": "mongodb-mcp-server",
            "user-agent": params.config.serverVersion
                ? `mongodb-mcp-server/v${params.config.serverVersion}`
                : "mongodb-mcp-server",
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        // Assistant tool calls are not associated with a specific Atlas project or organization
        // Therefore, we don't have any values to add to the telemetry metadata
        return {};
    }

    protected async callAssistantApi(args: {
        method: "GET" | "POST";
        endpoint: string;
        body?: unknown;
    }): Promise<Response> {
        const endpointUrl = new URL(args.endpoint, this.baseUrl);
        const headers = new Headers(this.requiredHeaders);
        if (args.method === "POST") {
            headers.set("Content-Type", "application/json");
        }

        // Use the same custom fetch implementation as the Atlas API client.
        // We need this to support enterprise proxies.
        const customFetch = createFetch({
            useEnvironmentVariableProxies: true,
        }) as unknown as typeof fetch;

        return await customFetch(endpointUrl, {
            method: args.method,
            headers,
            body: JSON.stringify(args.body),
        });
    }
}
