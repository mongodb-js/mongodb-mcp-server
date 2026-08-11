export enum ErrorCodes {
    NotConnectedToMongoDB = 1_000_000,
    MisconfiguredConnectionString = 1_000_001,
    ForbiddenCollscan = 1_000_002,
    ForbiddenWriteOperation = 1_000_003,
    AtlasSearchNotSupported = 1_000_004,
    AtlasVectorSearchIndexNotFound = 1_000_006,
    AtlasVectorSearchInvalidQuery = 1_000_007,
    InvalidPipeline = 1_000_008,
    ForbiddenServerSideJS = 1_000_009,
    UnknownConnectionId = 1_000_010,
    ConfirmationDeclined = 1_000_011,
}

export class MongoDBError<ErrorCode extends ErrorCodes = ErrorCodes> extends Error {
    constructor(
        public code: ErrorCode,
        message: string
    ) {
        super(message);
        this.name = "MongoDBError";
    }
}

/** Type guard that also preserves the precise `ErrorCode` type parameter. */
export function isMongoDBError(error: unknown): error is MongoDBError<ErrorCodes> {
    return error instanceof MongoDBError;
}

/**
 * Marks a tool failure as infrastructure or unintentional rather than caller-addressable, so
 * `classifyToolError` records it as `error_expected="false"` on the tool metric.
 */
export class UnexpectedError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "UnexpectedError";
    }
}
