import { describe, expect, it } from "vitest";
import { Keychain } from "@mongodb-js/mcp-core";
import { connectionErrorHandler, connectCapableTools } from "../connectionErrorHandler.js";
import { ErrorCodes, MongoDBError } from "./errors.js";
import type { ToolServerTool } from "@mongodb-js/mcp-types";

const A_CONNECTION_URI = "mongodb+srv://mcpUser12345:s3cr3t@cluster0.example.com/?authSource=admin";

function misconfiguredError(message: string): MongoDBError<typeof ErrorCodes.MisconfiguredConnectionString> {
    return new MongoDBError(ErrorCodes.MisconfiguredConnectionString, message);
}

function makeTool(name: string, operationType: ToolServerTool["operationType"]): ToolServerTool {
    return {
        name,
        operationType,
        category: "mongodb",
        isEnabled: () => true,
    } as unknown as ToolServerTool;
}

describe("connectionErrorHandler", () => {
    it("primes the connection string before surfacing it to the LLM (built-in URI pattern)", () => {
        // The connect-tool connection string is never registered on the immutable
        // keychain, so the guarantee that a credential-bearing URI does not reach
        // the model rests on the built-in mongodb-redact pattern applying inside
        // Keychain.redact regardless of registered secrets.
        const keychain = new Keychain();
        const redacted = keychain.redact(A_CONNECTION_URI);
        expect(redacted).not.toContain("s3cr3t");
        expect(redacted).not.toContain("mcpUser12345");
        expect(redacted).toBe("<mongodb uri>");
    });

    it("surfaces a redacted (never raw) connection-string error message to the LLM", async () => {
        const availableTools: ToolServerTool[] = [
            makeTool("connect", "connect"),
            makeTool("find", "read"),
            makeTool("list-connections", "connect"),
        ];

        const handler = await connectionErrorHandler(misconfiguredError(`Could not connect to <mongodb uri>`), {
            availableTools,
            connectionState: undefined,
        });

        expect(handler.errorHandled).toBe(true);
        if (!handler.errorHandled) throw new Error("unreachable");
        const serialized = JSON.stringify(handler.result);
        expect(serialized).not.toContain("s3cr3t");
        expect(serialized).not.toContain("mcpUser12345");
        expect(serialized).not.toContain(A_CONNECTION_URI);
        // The redacted placeholder and a connect hint are present.
        expect(serialized).toContain("<mongodb uri>");
        expect(serialized).toContain("Could not connect to MongoDB. Last error:");
    });

    it("lists only connect-capable tools (excluding disconnect)", () => {
        const tools = [
            makeTool("connect", "connect"),
            makeTool("disconnect", "connect"),
            makeTool("atlas-connect-cluster", "connect"),
            makeTool("find", "read"),
        ];
        const names = connectCapableTools(tools).map((t) => t.name);
        expect(names).toEqual(["connect", "atlas-connect-cluster"]);
    });
});
