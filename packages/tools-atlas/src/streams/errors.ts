import { ErrorCodes, MongoDBError } from "@mongodb-js/mcp-tools-mongodb";

/**
 * Creates a caller-addressable error for invalid or incomplete Streams tool arguments.
 *
 * Using MongoDBError rather than a plain Error allows Remote MCP to classify the
 * failure as expected without relying on the caller-facing message.
 */
export function streamsInvalidArgument(message: string): MongoDBError<typeof ErrorCodes.InvalidArgument> {
    return new MongoDBError(ErrorCodes.InvalidArgument, message);
}
