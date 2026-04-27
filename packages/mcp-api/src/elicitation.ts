import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";

export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

/**
 * Service for requesting structured input from the connected MCP client.
 * Concrete implementations live in `@mongodb-js/mcp-core`.
 */
export interface IElicitation {
    /**
     * Returns true if the client supports the elicitation capability.
     */
    supportsElicitation(): boolean;

    /**
     * Requests a yes/no confirmation from the user. If the client does not
     * support elicitation, returns true.
     */
    requestConfirmation(message: string): Promise<boolean>;

    /**
     * Requests structured input from the user via a form. Returns the accepted
     * fields, or `{ accepted: false }` if the client doesn't support
     * elicitation or the user declined.
     */
    requestInput(
        message: string,
        schema: ElicitRequestFormParams["requestedSchema"]
    ): Promise<ElicitedInputResult>;
}
