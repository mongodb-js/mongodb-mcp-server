export const ErrorCodes = {
    NotConnectedToMongoDB: 1_000_000,
    MisconfiguredConnectionString: 1_000_001,
    ForbiddenCollscan: 1_000_002,
    ForbiddenWriteOperation: 1_000_003,
    AtlasSearchNotSupported: 1_000_004,
    AtlasVectorSearchIndexNotFound: 1_000_006,
    AtlasVectorSearchInvalidQuery: 1_000_007,
    InvalidPipeline: 1_000_008,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class MongoDBError extends Error {
    code: ErrorCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
