import { ToolBase } from "@mongodb-js/mcp-core";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import type { TelemetryToolMetadata, IToolConfig, ToolCategory, ISession } from "@mongodb-js/mcp-types";
import { getSharedProxyFetch } from "@mongodb-js/mcp-fetch";

export const DEFAULT_ASSISTANT_BASE_URL = "https://knowledge.mongodb.com/api/v1/";

export interface IAssistantConfig extends IToolConfig {
    assistantBaseUrl?: string;
    serverVersion?: string;
}

export interface IAssistantSession extends ISession {
    config: IAssistantConfig;
}

export abstract class AssistantToolBase extends ToolBase<IAssistantSession> {
    static category: ToolCategory = "assistant";

    protected baseUrl: URL;
    protected requiredHeaders: Headers;

    constructor(params: ToolConstructorParams<IAssistantSession>) {
        super(params);
        this.baseUrl = new URL(params.session.config.assistantBaseUrl ?? DEFAULT_ASSISTANT_BASE_URL);
        this.requiredHeaders = new Headers({
            "x-request-origin": "mongodb-mcp-server",
            "user-agent": params.session.config.serverVersion
                ? `mongodb-mcp-server/v${params.session.config.serverVersion}`
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

        // Same shared, memoized fetch as the Atlas API client (proxy support
        // without reloading the system CA per call).
        const customFetch = getSharedProxyFetch();

        return await customFetch(endpointUrl, {
            method: args.method,
            headers,
            body: JSON.stringify(args.body),
        });
    }
}
