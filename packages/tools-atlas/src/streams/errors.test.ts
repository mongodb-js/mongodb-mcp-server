import { describe, expect, it } from "vitest";
import { ErrorCodes, MongoDBError } from "@mongodb-js/mcp-tools-mongodb";
import { streamsInvalidArgument } from "./errors.js";

describe("streamsInvalidArgument", () => {
    it("creates a caller-addressable MongoDBError", () => {
        const error = streamsInvalidArgument("workspaceName is required");

        expect(error).toBeInstanceOf(MongoDBError);
        expect(error.code).toBe(ErrorCodes.InvalidArgument);
        expect(error.message).toBe("workspaceName is required");
    });
});
