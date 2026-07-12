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
    /**
     * A per-call `connection` argument referenced a name that is not present in
     * the configured connection registry. Distinct from
     * {@link ErrorCodes.NotConnectedToMongoDB} / {@link ErrorCodes.MisconfiguredConnectionString}
     * so that failures for a named connection do not trigger the session-default
     * connection recovery handler.
     */
    NamedConnectionNotFound = 1_000_010,
    /**
     * Establishing a named connection from the registry failed (e.g. the target
     * cluster was unreachable). Kept separate from the session-default error
     * codes for the same reason as {@link ErrorCodes.NamedConnectionNotFound}.
     */
    NamedConnectionFailed = 1_000_011,
}

export class MongoDBError<ErrorCode extends ErrorCodes = ErrorCodes> extends Error {
    constructor(
        public code: ErrorCode,
        message: string
    ) {
        super(message);
    }
}
