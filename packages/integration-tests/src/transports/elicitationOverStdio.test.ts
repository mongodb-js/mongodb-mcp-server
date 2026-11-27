/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import path from "path";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Elicitation } from "mongodb-mcp-server";
import { createMockElicitInput } from "@mongodb-js/mcp-test-utils";

const currentDir = import.meta.dirname;
const projectRoot = path.resolve(currentDir, "../../../..");
const serverPath = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");

/**
 * Elicitation over stdio, driven by the real SDK client against the built
 * server, in BOTH protocol eras:
 *
 * - **2025-era**: the client opens with `initialize`, declaring its
 *   capabilities once for the connection.
 * - **2026-07-28**: there is no `initialize`; the client declares its
 *   capabilities on every request's `_meta` envelope, and the server must read
 *   them from there to decide whether to ask for confirmation.
 *
 * `drop-database` is a confirmation-required tool and the gate fires before
 * execution, so no MongoDB connection is needed: declining aborts, confirming
 * proceeds to execution (which then fails on the missing connection).
 */
describe("elicitation over stdio", () => {
    async function connectClient(
        era: "legacy" | "modern",
        mediateElicitInput: ReturnType<typeof createMockElicitInput> | undefined,
        { withElicitationCapability }: { withElicitationCapability: boolean }
    ): Promise<{ client: Client; transport: StdioClientTransport }> {
        const transport = new StdioClientTransport({
            command: "node",
            args: [serverPath, "--disabledTools", "atlas-local"],
            env: {
                MDB_MCP_TRANSPORT: "stdio",
                MDB_MCP_CONNECTION_STRING: "",
                MDB_MCP_TELEMETRY: "disabled",
            },
        });
        const capabilities = withElicitationCapability ? { elicitation: { form: {} } } : {};
        const client = new Client(
            { name: `elicit-stdio-${era}`, version: "1.0.0" },
            era === "modern" ? { versionNegotiation: { mode: "auto" }, capabilities } : { capabilities }
        );
        if (mediateElicitInput) {
            client.setRequestHandler("elicitation/create", mediateElicitInput.handler as never);
        }
        await client.connect(transport);
        return { client, transport };
    }

    function callDropDatabase(client: Client): ReturnType<Client["callTool"]> {
        return client.callTool({
            name: "drop-database",
            arguments: { connectionId: "preconfigured", database: "test-db" },
        });
    }

    for (const era of ["legacy", "modern"] as const) {
        describe(`${era} era`, () => {
            describe("client with elicitation capability", () => {
                const mockElicitInput = createMockElicitInput();
                let client: Client;
                let transport: StdioClientTransport;

                beforeAll(async () => {
                    ({ client, transport } = await connectClient(era, mockElicitInput, {
                        withElicitationCapability: true,
                    }));
                }, 60_000);

                afterAll(async () => {
                    await client?.close();
                    await transport?.close();
                });

                beforeEach(() => {
                    mockElicitInput.clear();
                });

                it(`negotiates the ${era} era`, () => {
                    expect(client.getProtocolEra()).toBe(era);
                });

                it("elicits confirmation before a confirmation-required tool", async () => {
                    mockElicitInput.confirmYes();

                    const result = await callDropDatabase(client);

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(mockElicitInput.mock).toHaveBeenCalledWith(
                        expect.objectContaining({
                            message: expect.stringContaining("You are about to drop the **test\\-db** database"),
                            requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                            mode: "form",
                        }) as never
                    );
                    expect(result.isError).toBe(true);
                    expect(result.content).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                type: "text",
                                text: expect.stringContaining("does not exist or has expired"),
                            }),
                        ])
                    );
                });

                it("does not run the tool when the user declines", async () => {
                    mockElicitInput.mock.mockResolvedValue({ action: "decline" });

                    const result = await callDropDatabase(client);

                    expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                    expect(result.isError).toBe(true);
                    expect(result.content).toEqual([
                        {
                            type: "text",
                            text: "User did not confirm the execution of the `drop-database` tool so the operation was not performed.",
                        },
                    ]);
                });
            });

            describe("client without elicitation capability", () => {
                let client: Client;
                let transport: StdioClientTransport;

                beforeAll(async () => {
                    ({ client, transport } = await connectClient(era, undefined, {
                        withElicitationCapability: false,
                    }));
                }, 60_000);

                afterAll(async () => {
                    await client?.close();
                    await transport?.close();
                });

                it("is never prompted and runs the tool directly", async () => {
                    const result = await callDropDatabase(client);

                    expect(result.isError).toBe(true);
                    expect(result.content).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                type: "text",
                                text: expect.stringContaining("does not exist or has expired"),
                            }),
                        ])
                    );
                });
            });
        });
    }
});
