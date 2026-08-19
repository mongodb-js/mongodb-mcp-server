import { MongoServerError } from "mongodb";
import { ErrorCodes, isMongoDBError, UnexpectedError } from "./errors.js";
import { ApiClientError } from "./atlas/apiClientError.js";

export function classifyToolError(error: unknown): ToolErrorKind {
    if (error instanceof UnexpectedError) {
        return "unexpected";
    }
    if (error instanceof ApiClientError) {
        return error.response.status >= 400 && error.response.status < 500 ? "expected" : "unexpected";
    }
    if (isMongoDBError(error)) {
        return MONGODB_ERROR_KINDS[error.code];
    }
    // Data-plane operation rejections: the bulk/write-concern subclasses all
    // extend `MongoServerError`, so one instanceof covers the family.
    if (error instanceof MongoServerError) {
        return "expected";
    }

    return "unexpected";
}

/**
 * `"expected"` = caller-addressable (Atlas API 4xx, rejected operations,
 * bad input); `"unexpected"` = infrastructure (Atlas API 5xx, broken
 * connections) and what error-rate alerts should count. Throw
 * {@link UnexpectedError} to force `"unexpected"`.
 */
export type ToolErrorKind = "expected" | "unexpected";

// Exhaustive per-code map: new `ErrorCodes` members force a decision here
// instead of silently defaulting to "expected". The "unexpected" pair mirrors
// the connection-failure set in `connectionErrorHandler.ts`.
const MONGODB_ERROR_KINDS = {
    [ErrorCodes.NotConnectedToMongoDB]: "unexpected",
    [ErrorCodes.MisconfiguredConnectionString]: "unexpected",
    [ErrorCodes.ForbiddenCollscan]: "expected",
    [ErrorCodes.ForbiddenWriteOperation]: "expected",
    [ErrorCodes.AtlasSearchNotSupported]: "expected",
    [ErrorCodes.AtlasVectorSearchIndexNotFound]: "expected",
    [ErrorCodes.AtlasVectorSearchInvalidQuery]: "expected",
    [ErrorCodes.InvalidPipeline]: "expected",
    [ErrorCodes.ForbiddenServerSideJS]: "expected",
    [ErrorCodes.UnknownConnectionId]: "expected",
    [ErrorCodes.ConfirmationDeclined]: "expected",
} as const satisfies Record<ErrorCodes, ToolErrorKind>;
