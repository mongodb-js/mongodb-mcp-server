import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

/**
 * Outcome of a confirmation elicitation.
 *
 * `ok: true` means the user explicitly confirmed and the caller may
 * proceed. Both `ok: false` reasons mean the caller MUST refuse the
 * operation; they are kept distinct so the caller can produce a
 * different, actionable error message for each — a user who declined
 * sees a different message than a client that can't show a prompt at
 * all.
 *
 * This replaces a previous `Promise<boolean>` shape that conflated the
 * two failure modes and returned `true` (proceed) when the client did
 * not advertise elicitation support. See OWASP MCP Top 10 (2025) item
 * MCP06 — Intent Flow Subversion — for the rationale.
 */
export type ConfirmationResult =
    | { ok: true }
    | { ok: false; reason: "declined" | "no-elicitation-support" };

const ELICITATION_TIMEOUT_MS = 300_000; // 5 minutes for user interaction

export class Elicitation {
    private readonly server: McpServer["server"];
    constructor({ server }: { server: McpServer["server"] }) {
        this.server = server;
    }

    /**
     * Checks if the client supports elicitation capabilities.
     * @returns True if the client supports elicitation, false otherwise.
     */
    public supportsElicitation(): boolean {
        const clientCapabilities = this.server.getClientCapabilities();
        return clientCapabilities?.elicitation !== undefined;
    }

    /**
     * Requests a boolean confirmation from the user.
     *
     * Fails closed: if the connected client does not advertise the
     * `elicitation` capability there is no way to obtain explicit
     * consent, so the caller MUST refuse to proceed
     * (`{ ok: false, reason: "no-elicitation-support" }`). The previous
     * behaviour returned `true` in that case, which let
     * confirmation-gated tools execute without any user prompt against
     * clients that don't support elicitation — a silent bypass of
     * `confirmationRequiredTools`. See OWASP MCP06.
     *
     * @param message - The message to display to the user.
     */
    public async requestConfirmation(message: string): Promise<ConfirmationResult> {
        if (!this.supportsElicitation()) {
            return { ok: false, reason: "no-elicitation-support" };
        }

        const result = await this.server.elicitInput(
            {
                mode: "form",
                message,
                requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
            },
            { timeout: ELICITATION_TIMEOUT_MS }
        );
        if (result.action === "accept" && result.content?.confirmation === "Yes") {
            return { ok: true };
        }
        return { ok: false, reason: "declined" };
    }

    /**
     * Requests structured input from the user via a form.
     * Returns the accepted fields, or { accepted: false } if the client doesn't
     * support elicitation or the user declined.
     *
     * @param message - The message/title to display in the form.
     * @param schema - A JSON Schema describing the fields to collect.
     * @returns The user-provided values keyed by field name, or null if declined/unsupported.
     */
    public async requestInput(
        message: string,
        schema: ElicitRequestFormParams["requestedSchema"]
    ): Promise<ElicitedInputResult> {
        if (!this.supportsElicitation()) {
            return { accepted: false };
        }

        const result = await this.server.elicitInput(
            {
                mode: "form",
                message,
                requestedSchema: schema,
            },
            { timeout: ELICITATION_TIMEOUT_MS }
        );

        if (result.action !== "accept" || !result.content) {
            return { accepted: false };
        }

        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.content)) {
            if (typeof value === "string") {
                fields[key] = value;
            }
        }
        return { accepted: true, fields };
    }

    /**
     * The schema for the confirmation question.
     * TODO: In the future would be good to use Zod 4's toJSONSchema() to generate the schema.
     */
    public static CONFIRMATION_SCHEMA = {
        type: "object" as const,
        properties: {
            confirmation: {
                type: "string" as const,
                title: "Would you like to confirm?",
                description: "Would you like to confirm?",
                enum: ["Yes", "No"],
                enumNames: ["Yes, I confirm", "No, I do not confirm"],
            },
        },
        required: ["confirmation"],
    } satisfies ElicitRequestFormParams["requestedSchema"];
}
