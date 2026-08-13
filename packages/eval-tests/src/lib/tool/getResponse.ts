import { tool, type Tool } from "ai";
import { z } from "zod";

/**
 * Synthetic judge tool exposing the assistant's last message response.
 * judge when a criterion references `$response`.
 */
export class GetResponseTool {
    public static readonly toolName: string = "get_response";
    public static readonly keyword: string = "$response";
    #response: string;

    /**
     * @param response - The last message response of the assistant.
     */
    constructor(response: string) {
        this.#response = response;
    }

    getTool(): Tool {
        return tool({
            description: `Returns the assistant's final response text. Call this when the criteria references ${GetResponseTool.keyword}.`,
            inputSchema: z.object({}),
            execute: () => ({ response: this.#response }),
        });
    }
}
