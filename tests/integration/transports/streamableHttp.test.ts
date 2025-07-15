import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

describe("StreamableHttpRunner", () => {
    let runner: StreamableHttpRunner;

    beforeAll(async () => {
        runner = new StreamableHttpRunner();
        await runner.start();
    });

    afterAll(async () => {
        await runner.close();
    });

    describe("client connects successfully", () => {
        let client: StreamableHTTPClientTransport;
        beforeAll(async () => {
            client = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3000/mcp"));
            await client.start();
        });

        afterAll(async () => {
            await client.close();
        });

        it("handles requests and sends responses", async () => {
            let fixedResolve: ((value: JSONRPCMessage) => void) | undefined = undefined;
            const messagePromise = new Promise<JSONRPCMessage>((resolve) => {
                fixedResolve = resolve;
            });

            client.onmessage = (message: JSONRPCMessage) => {
                fixedResolve?.(message);
            };

            await client.send({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
                params: {
                    _meta: {
                        progressToken: 1,
                    },
                },
            });

            const message = (await messagePromise) as {
                jsonrpc: string;
                id: number;
                result: {
                    tools: {
                        name: string;
                        description: string;
                    }[];
                };
                error?: {
                    code: number;
                    message: string;
                };
            };

            expect(message.jsonrpc).toBe("2.0");
            expect(message.id).toBe(1);
            expect(message.result).toBeDefined();
            expect(message.result?.tools).toBeDefined();
            expect(message.result?.tools.length).toBeGreaterThan(0);
            const tools = message.result?.tools;
            tools.sort((a, b) => a.name.localeCompare(b.name));
            expect(tools[0]?.name).toBe("aggregate");
            expect(tools[0]?.description).toBe("Run an aggregation against a MongoDB collection");
        });
    });
});
