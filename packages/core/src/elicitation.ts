import { acceptedContent, inputRequired } from "@modelcontextprotocol/server";
import type {
    ElicitRequestFormParams,
    InputRequiredResult,
    InputResponses,
    McpServer,
} from "@modelcontextprotocol/server";

/** Read input-responses values that arrive loosely typed from the client. */
export type ElicitationInputResponses = InputResponses | Record<string, unknown> | undefined;
import type { ElicitedInputResult, ElicitInputRequiredParams, IElicitation } from "@mongodb-js/mcp-types";

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
     * Checks if the client supports elicitation capabilities.
     * @returns True if the client supports elicitation, false otherwise.
     */
    public supportsElicitation(): boolean {
        const clientCapabilities = this.server.getClientCapabilities();
        return clientCapabilities?.elicitation !== undefined;
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
        const content = acceptedContent<{ confirmation?: string }>(inputResponses, CONFIRMATION_INPUT_KEY);
        if (content === undefined) {
            return undefined;
        }
        return content.confirmation === "Yes";
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
