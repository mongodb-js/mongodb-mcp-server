/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Elicitation, type UserConfig } from "mongodb-mcp-server";
import { createMockElicitInput } from "@mongodb-js/mcp-test-utils";
import { defaultTestConfig } from "../integrationHelpers.js";
import {
    createStreamableHttpTestRunner,
    type StreamableHttpTestRunnerComponents,
} from "../helpers/streamableHttpTestRunner.js";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import type { CliServer } from "mongodb-mcp-server";

/**
 * Elicitation over streamable HTTP, driven by the real SDK client, in BOTH
 * protocol eras:
 *
 * - **2025-era (stateful)**: the client connects without version negotiation
 *   (the default `initialize` handshake). The server serves it sessionfully via
 *   {@link LegacyMcpHttpHandler}, which keeps the client's `initialize`-declared
 *   capabilities and the SSE return channel on a live session — what the SDK's
 *   legacy elicitation shim needs to deliver `input_required` as real
 *   server→client `elicitation/create` requests.
 *
 * - **2026-07-28 (stateless)**: the client negotiates the modern era. Each
 *   request carries the client capabilities in the `_meta` envelope, and
 *   `input_required` returns in-band; the client auto-fulfils it through the
 *   same `elicitation/create` handler and retries.
 *
 * In both cases `drop-database` is a confirmation-required tool, and the
 * elicitation gate fires before execution, so we don't need a real MongoDB
 * connection: declining aborts, confirming proceeds to execution (which then
 * fails on the missing connection, but proves the gate ran).
 */
describe("elicitation over streamable HTTP", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let serverAddress: () => string;

    beforeAll(async () => {
        const config: UserConfig = { ...defaultTestConfig, httpPort: 0 };
        const components: StreamableHttpTestRunnerComponents = createStreamableHttpTestRunner(config);
        runner = components.runner;
        serverAddress = components.getServerAddress;
        await runner.start();
    }, 120_000);

    afterAll(async () => {
        await runner?.close();
    });

    /** Wires an SDK client over streamable HTTP for the given era. */
    async function connectClient(
        era: "legacy" | "modern",
        mediateElicitInput: ReturnType<typeof createMockElicitInput> | undefined,
        options: { withElicitationCapability: boolean } = { withElicitationCapability: true }
    ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
        const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress()}/mcp`), {});
        const capabilities = options.withElicitationCapability ? { elicitation: {} } : {};
        const client = new Client(
            { name: `elicit-${era}`, version: "1.0.0" },
            era === "modern" ? { versionNegotiation: { mode: "auto" }, capabilities } : { capabilities }
        );
        // Both eras deliver the embedded request to the same client-side
        // `elicitation/create` handler (modern auto-fulfilment / legacy shim).
        if (mediateElicitInput) {
            client.setRequestHandler("elicitation/create", mediateElicitInput.handler as never);
        }
        await client.connect(transport);
        return { client, transport };
    }

    for (const era of ["legacy", "modern"] as const) {
        describe(`${era} era`, () => {
            const mockElicitInput = createMockElicitInput();
            let client: Client;
            let transport: StreamableHTTPClientTransport;

            beforeAll(async () => {
                ({ client, transport } = await connectClient(era, mockElicitInput));
            });

            afterAll(async () => {
                await client?.close();
                await transport?.close();
            });

            beforeEach(() => {
                mockElicitInput.clear();
            });

            it("elicit confirmation before a confirmation-required tool", async () => {
                mockElicitInput.confirmYes();

                const result = await client.callTool({
                    name: "drop-database",
                    arguments: { connectionId: "preconfigured", database: "test-db" },
                });

                // The confirmation message + schema reached the client's handler.
                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith(
                    expect.objectContaining({
                        message: expect.stringContaining("You are about to drop the **test\\-db** database"),
                        requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                        mode: "form",
                    }) as never
                );

                // Confirming proceeds to execution, which fails on the missing
                // connection — proving the gate ran rather than the tool being
                // skipped.
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
                mockElicitInput.confirmNo();

                const result = await client.callTool({
                    name: "drop-database",
                    arguments: { connectionId: "preconfigured", database: "test-db" },
                });

                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(result.isError).toBe(true);
                expect(result.content).toEqual([
                    {
                        type: "text",
                        text: "User did not confirm the execution of the `drop-database` tool so the operation was not performed.",
                    },
                ]);
            });

            describe("client without elicitation capability", () => {
                let bareClient: Client;
                let bareTransport: StreamableHTTPClientTransport;

                beforeAll(async () => {
                    // No `elicitation` capability and no handler: the gate must
                    // short-circuit and run the tool directly, never prompting.
                    ({ client: bareClient, transport: bareTransport } = await connectClient(era, undefined, {
                        withElicitationCapability: false,
                    }));
                });

                afterAll(async () => {
                    await bareClient?.close();
                    await bareTransport?.close();
                });

                it("is never prompted and runs the tool directly", async () => {
                    const result = await bareClient.callTool({
                        name: "drop-database",
                        arguments: { connectionId: "preconfigured", database: "test-db" },
                    });

                    // No elicitation handler was registered, so if the server had
                    // prompted, the client would have failed to fulfil it. Instead
                    // the tool runs directly and fails on the missing connection.
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
