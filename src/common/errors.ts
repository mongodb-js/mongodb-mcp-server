export enum ErrorCodes {
    NotConnectedToMongoDB = 1_000_000,
    MisconfiguredConnectionString = 1_000_001,
    ForbiddenCollscan = 1_000_002,
    ForbiddenWriteOperation = 1_000_003,
}

export class MongoDBError<ErrorCode extends ErrorCodes = ErrorCodes> extends Error {
    constructor(
        public code: ErrorCode,
        message: string
    ) {
        super(message);
    }
}
