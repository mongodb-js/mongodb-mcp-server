import { ErrorCodes, MongoDBError } from "@mongodb-js/mcp-tools-mongodb";

/** A caller-addressable error for invalid or incomplete Streams tool arguments. */
export class StreamsInvalidArgumentError extends MongoDBError<typeof ErrorCodes.InvalidArgument> {
    constructor(message: string) {
        super(ErrorCodes.InvalidArgument, message);
        this.name = "StreamsInvalidArgumentError";
    }
}
