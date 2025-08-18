import { Decimal128, MaxKey, MinKey, ObjectId, Timestamp, UUID } from "bson";
import { createStdioTransport, EJsonReadBuffer } from "../../../src/transports/stdio.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Readable } from "stream";
import { ReadBuffer } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
describe("stdioTransport", () => {
    let transport: StdioServerTransport;
    beforeEach(async () => {
        transport = createStdioTransport();
        await transport.start();
    });

    afterEach(async () => {
        await transport.close();
    });

    it("ejson deserializes messages", () => {
        const messages: { message: JSONRPCMessage; extra?: { authInfo?: AuthInfo } }[] = [];
        transport.onmessage = (
            message,
            extra?: {
                authInfo?: AuthInfo;
            }
        ): void => {
            messages.push({ message, extra });
        };

        (transport["_stdin"] as Readable).emit(
            "data",
            Buffer.from(
                '{"jsonrpc":"2.0","id":1,"method":"testMethod","params":{"oid":{"$oid":"681b741f13aa74a0687b5110"},"uuid":{"$uuid":"f81d4fae-7dec-11d0-a765-00a0c91e6bf6"},"date":{"$date":"2025-05-07T14:54:23.973Z"},"decimal":{"$numberDecimal":"1234567890987654321"},"int32":123,"maxKey":{"$maxKey":1},"minKey":{"$minKey":1},"timestamp":{"$timestamp":{"t":123,"i":456}}}}\n',
                "utf-8"
            )
        );

        expect(messages.length).toBe(1);
        const message = messages[0]?.message;

        expect(message).toEqual({
            jsonrpc: "2.0",
            id: 1,
            method: "testMethod",
            params: {
                oid: new ObjectId("681b741f13aa74a0687b5110"),
                uuid: new UUID("f81d4fae-7dec-11d0-a765-00a0c91e6bf6"),
                date: new Date(Date.parse("2025-05-07T14:54:23.973Z")),
                decimal: new Decimal128("1234567890987654321"),
                int32: 123,
                maxKey: new MaxKey(),
                minKey: new MinKey(),
                timestamp: new Timestamp({ t: 123, i: 456 }),
            },
        });
    });

    it("has _readBuffer field of type EJsonReadBuffer", () => {
        expect(transport["_readBuffer"]).toBeDefined();
        expect(transport["_readBuffer"]).toBeInstanceOf(EJsonReadBuffer);
    });

    describe("standard StdioServerTransport", () => {
        it("has a _readBuffer field", () => {
            const standardTransport = new StdioServerTransport();
            expect(standardTransport["_readBuffer"]).toBeDefined();
            expect(standardTransport["_readBuffer"]).toBeInstanceOf(ReadBuffer);
        });
    });
});
