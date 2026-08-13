import type {
    ElicitRequestFormParams,
    ProgressToken,
    RequestId,
    ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";

export type ElicitedInputResult =
    | { accepted: true; fields: Record<string, string> }
    | { accepted: false; fields?: undefined };

/** The schema accepted by {@link IElicitation.requestInput}. */
export type ElicitRequestSchema = ElicitRequestFormParams["requestedSchema"];

export type ElicitationOptions = {
    /** The id of the in-flight client request this elicitation belongs to. */
    relatedRequestId?: RequestId;
    /** The progress token supplied by the client on the in-flight request. */
    progressToken?: ProgressToken;
    /** Sends a notification related to the in-flight request. */
    sendNotification?: (notification: ServerNotification) => Promise<void>;
    /** The abort signal of the in-flight request. */
    signal?: AbortSignal;
};

export interface IElicitation {
    supportsElicitation(): boolean;
    requestConfirmation(message: string, options?: ElicitationOptions): Promise<boolean>;
    requestInput(message: string, schema: ElicitRequestSchema, options?: ElicitationOptions): Promise<ElicitedInputResult>;
}
