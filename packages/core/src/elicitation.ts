import {
    acceptedContent,
    CLIENT_CAPABILITIES_META_KEY,
    inputRequired,
    inputResponse,
} from "@modelcontextprotocol/server";
import type {
    ClientCapabilities,
    ElicitRequestFormParams,
    InputRequiredResult,
    McpServer,
} from "@modelcontextprotocol/server";
import type {
    ElicitationInputResponses,
    ElicitationRequestContext,
    ElicitedInputResult,
    ElicitInputRequiredParams,
    IElicitation,
} from "@mongodb-js/mcp-types";

export type { ElicitationInputResponses };

/** The inputResponses identifier under which confirmation answers arrive. */
export const CONFIRMATION_INPUT_KEY = "confirmation";

/**
 * The identifier under which the confirmation answer's accepted content
 * carries the user's choice (enum values "Yes"/"No").
 */
const CONFIRMATION_FIELD = "confirmation";

/**
 * Elicitation service implementing the multi-round-trip (`inputRequired`)
 * style of protocol revision 2026-07-28: handlers return an
 * `inputRequired` result when they need confirmation or form input, and the
 * client retries the original request carrying the answers in
 * `inputResponses`. On 2025-era connections the SDK's legacy shim serves
 * the same writes transparently by issuing real server→client requests.
 *
 * See {@link IElicitation} for the builder/reader contract.
 */
export class Elicitation implements IElicitation {
    private readonly server: McpServer["server"];

    constructor({ server }: { server: McpServer["server"] }) {
        this.server = server;
    }

    /**
     * Checks whether the client that issued `request` supports elicitation.
     *
     * A 2026-07-28 request declares the client's capabilities on its own
     * `_meta` envelope; that declaration is authoritative for the request.
     * Requests without one fall back to the `initialize`-negotiated
     * capabilities of a 2025-era connection. `getClientCapabilities()` alone
     * is not enough: it is populated only by `initialize` (or, on HTTP, by
     * `createMcpHandler`'s backfill), so it is empty for 2026-07-28 clients
     * served by `serveStdio`.
     *
     * @returns True if the client supports elicitation, false otherwise.
     */
    public supportsElicitation(request: ElicitationRequestContext): boolean {
        const clientCapabilities =
            Elicitation.envelopeClientCapabilities(request) ?? this.server.getClientCapabilities();
        return clientCapabilities?.elicitation !== undefined;
    }

    private static envelopeClientCapabilities(request: ElicitationRequestContext): ClientCapabilities | undefined {
        const envelope: Record<string, unknown> | undefined = request.raw?.envelope;
        const declared = envelope?.[CLIENT_CAPABILITIES_META_KEY];
        return typeof declared === "object" && declared !== null ? declared : undefined;
    }

    /**
     * Builds the `inputRequired` result asking the user to confirm an
     * operation. Return it from the request handler; read the answer back on
     * re-entry with {@link Elicitation.readConfirmation}.
     */
    public confirmationRequired(message: string): InputRequiredResult {
        return inputRequired({
            inputRequests: {
                [CONFIRMATION_INPUT_KEY]: inputRequired.elicit({
                    mode: "form",
                    message,
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                }),
            },
        });
    }

    /**
     * Reads the user's answer to a {@link Elicitation.confirmationRequired}
     * request from a retried request's `inputResponses`.
     *
     * @returns `true` when the user confirmed, `false` when they declined, and
     * `undefined` when this round carries no answer yet.
     */
    public readConfirmation(inputResponses: ElicitationInputResponses): boolean | undefined {
        if (inputResponses === undefined) {
            return undefined;
        }
        const response = inputResponse(inputResponses, CONFIRMATION_INPUT_KEY);
        if (response.kind === "missing") {
            return undefined;
        }
        if (response.kind !== "elicit" || response.action !== "accept") {
            // Declined, cancelled, or a response of another kind: the user did
            // not confirm, and re-prompting would ignore their explicit answer.
            return false;
        }
        return response.content?.confirmation === "Yes";
    }

    /**
     * Builds the `inputRequired` result asking the user for structured input
     * via a form. Return it from the request handler; read the answers back on
     * re-entry with {@link Elicitation.readInput}.
     */
    public inputRequired({ key, message, schema }: ElicitInputRequiredParams): InputRequiredResult {
        return inputRequired({
            inputRequests: {
                [key]: inputRequired.elicit({
                    mode: "form",
                    message,
                    requestedSchema: schema,
                }),
            },
        });
    }

    /**
     * Reads the accepted fields of a {@link Elicitation.inputRequired} request
     * from a retried request's `inputResponses`.
     *
     * @returns `{ accepted: true, fields }`, `{ accepted: false }` when the
     * user declined/cancelled (or the client does not support elicitation),
     * and `undefined` when this round carries no response for `key` yet.
     */
    public readInput(inputResponses: ElicitationInputResponses, key: string): ElicitedInputResult | undefined {
        if (inputResponses === undefined) {
            return undefined;
        }
        const content = acceptedContent<Record<string, unknown>>(inputResponses, key);
        if (content === undefined) {
            return { accepted: false };
        }
        const fields: Record<string, string> = {};
        for (const [fieldKey, value] of Object.entries(content)) {
            if (typeof value === "string") {
                fields[fieldKey] = value;
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
            [CONFIRMATION_FIELD]: {
                type: "string" as const,
                title: "Would you like to confirm?",
                description: "Would you like to confirm?",
                enum: ["Yes", "No"],
                enumNames: ["Yes, I confirm", "No, I do not confirm"],
            },
        },
        required: [CONFIRMATION_FIELD],
    } satisfies ElicitRequestFormParams["requestedSchema"];
}
