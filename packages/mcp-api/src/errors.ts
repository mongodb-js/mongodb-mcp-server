/**
 * Numeric error codes thrown as `MongoDBError.code` by the MCP server.
 *
 * The concrete `MongoDBError` class lives in `@mongodb-js/mcp-core`. This
 * `mcp-api` package only exports the code identifiers and supporting type
 * aliases.
 */
export const ErrorCodes = {
    NotConnectedToMongoDB: 1_000_000,
    MisconfiguredConnectionString: 1_000_001,
    ForbiddenCollscan: 1_000_002,
    ForbiddenWriteOperation: 1_000_003,
    AtlasSearchNotSupported: 1_000_004,
    AtlasVectorSearchIndexNotFound: 1_000_006,
    AtlasVectorSearchInvalidQuery: 1_000_007,
} as const;

/**
 * Union of all numeric `ErrorCodes` values.
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
