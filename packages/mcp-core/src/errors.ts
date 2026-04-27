import { ErrorCodes, type ErrorCode } from "@mongodb-js/mcp-api";

export { ErrorCodes };
export type { ErrorCode };

export class MongoDBError<TErrorCode extends ErrorCode = ErrorCode> extends Error {
    constructor(
        public code: TErrorCode,
        message: string
    ) {
        super(message);
    }
}
