import type {
    ElicitRequestFormParams,
    ProgressToken,
    RequestId,
    ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

export type ElicitationOptions = {
    /**
     * The id of the in-flight client request (e.g. the tool call) this
     * elicitation belongs to. On the streamable HTTP transport this routes the
     * elicitation over that request's own SSE stream rather than the standalone
     * GET stream, which not all deployments support.
     */
    relatedRequestId?: RequestId;
    /**
     * The progress token supplied by the client on the in-flight request. When
     * provided together with `sendNotification`, progress notifications are
     * emitted while waiting for the user's response so that clients honoring
     * progress-based timeout resets don't time out the request mid-elicitation.
     */
    progressToken?: ProgressToken;
    /**
     * Sends a notification related to the in-flight request. Typically the
     * `sendNotification` function from the tool's execution context.
     */
    sendNotification?: (notification: ServerNotification) => Promise<void>;
};

const ELICITATION_TIMEOUT_MS = 300_000; // 5 minutes for user interaction

/**
 * How often to emit progress notifications while an elicitation is pending.
 * Frequent enough to beat common client request timeouts (the MCP SDK default
 * is 60 seconds) and infrastructure idle timeouts, without being chatty. The
 * heartbeat stops when the elicitation settles, so `ELICITATION_TIMEOUT_MS` is
 * its upper bound.
 */
const ELICITATION_PROGRESS_INTERVAL_MS = 15_000;

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
     * @param message - The message to display to the user.
     * @param options - Options controlling how the elicitation request is routed.
     * @returns True if the user confirms the action or the client does not support elicitation, false otherwise.
     */
    public async requestConfirmation(message: string, options?: ElicitationOptions): Promise<boolean> {
        if (!this.supportsElicitation()) {
            return true;
        }

        const stopHeartbeat = this.startProgressHeartbeat(options);
        try {
            const result = await this.server.elicitInput(
                {
                    mode: "form",
                    message,
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                },
                { timeout: ELICITATION_TIMEOUT_MS, relatedRequestId: options?.relatedRequestId }
            );
            return result.action === "accept" && result.content?.confirmation === "Yes";
        } finally {
            stopHeartbeat();
        }
    }

    /**
     * Requests structured input from the user via a form.
     * Returns the accepted fields, or { accepted: false } if the client doesn't
     * support elicitation or the user declined.
     *
     * @param message - The message/title to display in the form.
     * @param schema - A JSON Schema describing the fields to collect.
     * @param options - Options controlling how the elicitation request is routed.
     * @returns The user-provided values keyed by field name, or null if declined/unsupported.
     */
    public async requestInput(
        message: string,
        schema: ElicitRequestFormParams["requestedSchema"],
        options?: ElicitationOptions
    ): Promise<ElicitedInputResult> {
        if (!this.supportsElicitation()) {
            return { accepted: false };
        }

        const stopHeartbeat = this.startProgressHeartbeat(options);
        let result;
        try {
            result = await this.server.elicitInput(
                {
                    mode: "form",
                    message,
                    requestedSchema: schema,
                },
                { timeout: ELICITATION_TIMEOUT_MS, relatedRequestId: options?.relatedRequestId }
            );
        } finally {
            stopHeartbeat();
        }

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
     * Emits progress notifications for the in-flight request while an
     * elicitation is pending, so clients that reset request timeouts on
     * progress don't time out the request while the user is deciding. The
     * notifications also keep bytes flowing on the underlying stream, which
     * prevents infrastructure idle timeouts from severing it.
     *
     * No-op unless both a progress token and a notification sender are
     * provided. The returned function stops the heartbeat and must be called
     * once the elicitation settles.
     */
    private startProgressHeartbeat(options?: ElicitationOptions): () => void {
        const { progressToken, sendNotification } = options ?? {};
        if (progressToken === undefined || sendNotification === undefined) {
            return () => undefined;
        }

        let progress = 0;
        const sendHeartbeat = (): void => {
            // Delivery is best-effort: a failed heartbeat must not fail the
            // elicitation, and the elicitation's own timeout covers the case
            // where the connection is gone entirely.
            void sendNotification({
                method: "notifications/progress",
                params: {
                    progressToken,
                    progress: progress++,
                    message: "Waiting for the user's response",
                },
            }).catch(() => undefined);
        };

        sendHeartbeat();
        const interval = setInterval(sendHeartbeat, ELICITATION_PROGRESS_INTERVAL_MS);
        return () => clearInterval(interval);
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
