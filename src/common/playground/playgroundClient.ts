const PLAYGROUND_SEARCH_URL = "https://search-playground.mongodb.com/api/tools/code-playground/search";

/**
 * Payload for the Playground endpoint.
 */
export interface PlaygroundRunRequest {
    documents: string;
    aggregationPipeline: string;
    indexDefinition: string;
    synonyms: string;
}

/**
 * Successful response from Playground server.
 */
export interface PlaygroundRunResponse {
    documents: Array<Record<string, unknown>>;
}

/**
 * Error response from Playground server.
 */
interface PlaygroundRunErrorResponse {
    code: string;
    message: string;
}

/**
 * MCP specific Playground error public for tools.
 */
export class PlaygroundRunError extends Error implements PlaygroundRunErrorResponse {
    constructor(
        public message: string,
        public code: string
    ) {
        super(message);
    }
}

export enum RunErrorCode {
    NETWORK_ERROR = "NETWORK_ERROR",
    UNKNOWN = "UNKNOWN",
}

/**
 * Handles Search Playground requests, abstracting low-level details from MCP tools.
 * https://search-playground.mongodb.com
 */
export class PlaygroundClient {
    async run(request: PlaygroundRunRequest): Promise<PlaygroundRunResponse> {
        const options: RequestInit = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        };

        let response: Response;
        try {
            response = await fetch(PLAYGROUND_SEARCH_URL, options);
        } catch {
            throw new PlaygroundRunError("Cannot run pipeline.", RunErrorCode.NETWORK_ERROR);
        }

        if (!response.ok) {
            const runErrorResponse = await this.getRunErrorResponse(response);
            throw new PlaygroundRunError(runErrorResponse.message, runErrorResponse.code);
        }

        try {
            return (await response.json()) as PlaygroundRunResponse;
        } catch {
            throw new PlaygroundRunError("Response is not valid JSON.", RunErrorCode.UNKNOWN);
        }
    }

    private async getRunErrorResponse(response: Response): Promise<PlaygroundRunErrorResponse> {
        try {
            return (await response.json()) as PlaygroundRunErrorResponse;
        } catch {
            return {
                message: `HTTP ${response.status} ${response.statusText}.`,
                code: RunErrorCode.UNKNOWN,
            };
        }
    }
}
