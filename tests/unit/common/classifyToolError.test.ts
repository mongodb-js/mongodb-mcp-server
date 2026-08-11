import { describe, it, expect } from "vitest";
import { MongoServerError, MongoBulkWriteError, MongoWriteConcernError, MongoNetworkError } from "mongodb";
import { ErrorCodes, MongoDBError, UnexpectedError } from "../../../src/common/errors.js";
import { ApiClientError } from "../../../src/common/atlas/apiClientError.js";
import { classifyToolError } from "../../../src/common/classifyToolError.js";

const atlasApiError = (status: number, message = "error calling Atlas API"): Error =>
    ApiClientError.fromError(new Response(null, { status, statusText: String(status) }), message);

describe("classifyToolError", () => {
    describe("expected (caller-addressable) errors", () => {
        it.each([400, 401, 402, 403, 404, 409, 429])("Atlas API %s", (status) => {
            expect(classifyToolError(atlasApiError(status))).toBe("expected");
        });

        it.each([
            [ErrorCodes.UnknownConnectionId],
            [ErrorCodes.ForbiddenWriteOperation],
            [ErrorCodes.InvalidPipeline],
            [ErrorCodes.ForbiddenCollscan],
            [ErrorCodes.AtlasSearchNotSupported],
            [ErrorCodes.ConfirmationDeclined],
            [ErrorCodes.ForbiddenServerSideJS],
            [ErrorCodes.AtlasVectorSearchIndexNotFound],
            [ErrorCodes.AtlasVectorSearchInvalidQuery],
        ])("caller-addressable MongoDBError code %s", (code) => {
            expect(classifyToolError(new MongoDBError(code, "rejected"))).toBe("expected");
        });

        it.each([
            ["MongoServerError", new MongoServerError({ code: 11000, errmsg: "duplicate key" })],
            [
                "MongoBulkWriteError",
                new MongoBulkWriteError({ message: "duplicate key", code: 11000 }, {
                    n: 0,
                } as unknown as ConstructorParameters<typeof MongoBulkWriteError>[1]),
            ],
            [
                "MongoWriteConcernError",
                new MongoWriteConcernError({
                    ok: 1,
                    writeConcernError: { code: 64, errmsg: "write concern failed" },
                }),
            ],
        ])("data-plane operation rejection %s", (_name, error) => {
            expect(classifyToolError(error)).toBe("expected");
        });
    });

    describe("unexpected (infrastructure) errors", () => {
        it.each([500, 502, 503])("Atlas API %s", (status) => {
            expect(classifyToolError(atlasApiError(status))).toBe("unexpected");
        });

        it.each([
            [ErrorCodes.NotConnectedToMongoDB, "NotConnectedToMongoDB"],
            [ErrorCodes.MisconfiguredConnectionString, "MisconfiguredConnectionString"],
        ])("connection-broken MongoDBError code %s", (code) => {
            expect(classifyToolError(new MongoDBError(code, "dial failed"))).toBe("unexpected");
        });

        it.each([
            ["a plain Error", new Error("boom")],
            ["a driver network error", new MongoNetworkError("socket closed")],
            ["a non-Error value", "boom"],
            ["undefined", undefined],
            ["null", null],
        ])("%s", (_name, error) => {
            expect(classifyToolError(error)).toBe("unexpected");
        });

        it.each([
            ["an UnexpectedError", new UnexpectedError("infra broke")],
            ["an UnexpectedError with a cause", new UnexpectedError("api down", { cause: new Error("ECONNREFUSED") })],
        ])("%s", (_name, error) => {
            expect(classifyToolError(error)).toBe("unexpected");
        });

        it("overrides heuristics: UnexpectedError wrapping an Atlas API 4xx is unexpected", () => {
            const wrapped = new UnexpectedError("Atlas API misconfigured", {
                cause: atlasApiError(401, "unauthorized"),
            });
            expect(classifyToolError(wrapped)).toBe("unexpected");
        });

        it("overrides heuristics: UnexpectedError wrapping a data-plane rejection is unexpected", () => {
            const wrapped = new UnexpectedError("driver misbehaving", {
                cause: new MongoServerError({ code: 11000, errmsg: "duplicate key" }),
            });
            expect(classifyToolError(wrapped)).toBe("unexpected");
        });
    });
});
