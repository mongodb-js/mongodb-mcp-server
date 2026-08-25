import type { ElicitRequestFormParams, InputRequiredResult, InputResponses } from "@modelcontextprotocol/server";

/** Values that can be read back from a retried request's `inputResponses`. */
export type ElicitationInputResponses = InputResponses | Record<string, unknown> | undefined;

export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

/** The schema accepted by {@link IElicitation.inputRequired}. */
export type ElicitRequestSchema = ElicitRequestFormParams["requestedSchema"];

/**
 * Elicitation service used by tools to request confirmation or structured
 * input from the user.
 *
 * Protocol revision 2026-07-28 replaced push-style server→client requests
 * with **multi-round-trip**: a handler that needs user input returns
 * `inputRequired(...)` from the request handler and the client retries the
 * original request carrying the answers (`inputResponses`). The MongoDB MCP
 * server's handlers are written in that style once and serve both eras: on
 * 2025-era connections the SDK's legacy shim turns the same `inputRequired`
 * return into real server→client requests and re-enters the handler with the
 * collected responses.
 *
 * Implementations therefore expose two complementary halves:
 * - *builders* (`confirmationRequired`, `inputRequired`) that produce the
 *   `InputRequiredResult` a handler returns when the required input has not
 *   been provided yet;
 * - *readers* (`readConfirmation`, `readInput`) that extract the answers from
 *   a retried request's `inputResponses` (resent by the client verbatim on
 *   re-entry, so they must be treated as untrusted input).
 */
export interface IElicitation {
    /**
     * Checks if the client supports elicitation capabilities.
     * @returns True if the client supports elicitation, false otherwise.
     */
    supportsElicitation(): boolean;

    /**
     * Builds the `inputRequired` result asking the user to confirm an
     * operation. The handler returns it on the first entry; on re-entry the
     * answers are read back with {@link IElicitation.readConfirmation}.
     *
     * @param message - The message to display to the user.
     * @returns The `InputRequiredResult` to return from the request handler.
     */
    confirmationRequired(message: string): InputRequiredResult;

    /**
     * Reads the user's answer to a {@link IElicitation.confirmationRequired}
     * request from a retried request's `inputResponses`.
     *
     * @returns `true` when the user confirmed, `false` when they declined, and
     * `undefined` when this round carries no answer yet (the handler should
     * return {@link IElicitation.confirmationRequired} instead).
     */
    readConfirmation(inputResponses: ElicitationInputResponses): boolean | undefined;

    /**
     * Builds the `inputRequired` result asking the user for structured input
     * via a form. The handler returns it on the first entry; on re-entry the
     * answers are read back with {@link IElicitation.readInput}.
     *
     * @param key - The identifier the answers arrive under in `inputResponses`.
     * @param message - The message/title to display in the form.
     * @param schema - A JSON Schema describing the fields to collect.
     * @returns The `InputRequiredResult` to return from the request handler.
     */
    inputRequired(key: string, message: string, schema: ElicitRequestSchema): InputRequiredResult;

    /**
     * Reads the accepted fields of a {@link IElicitation.inputRequired}
     * request from a retried request's `inputResponses`.
     *
     * @returns `{ accepted: true, fields }` with the user-provided values keyed
     * by field name, `{ accepted: false }` when the user declined or cancelled
     * (or the client does not support elicitation), and `undefined` when this
     * round carries no response for `key` yet (the handler should return
     * {@link IElicitation.inputRequired} again).
     */
    readInput(inputResponses: ElicitationInputResponses, key: string): ElicitedInputResult | undefined;
}
