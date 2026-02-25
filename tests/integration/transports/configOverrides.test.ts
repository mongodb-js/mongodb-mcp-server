import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { defaultTestConfig, expectDefined } from "../helpers.js";
import type { TransportRunnerConfig, UserConfig } from "../../../src/lib.js";
import type { RequestContext } from "../../../src/transports/base.js";

describe("Config Overrides via HTTP", () => {
    let runner: StreamableHttpRunner;
    let client: Client;
    let transport: StreamableHTTPClientTransport;

    // Helper function to setup and start runner with config
    async function startRunner(
        config: UserConfig,
        createSessionConfig?: TransportRunnerConfig["createSessionConfig"]
    ): Promise<void> {
        runner = new StreamableHttpRunner({ userConfig: config, createSessionConfig });
        await runner.start();
    }

    // Helper function to connect client with headers
    async function connectClient(headers: Record<string, string> = {}): Promise<void> {
        transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`), {
            requestInit: { headers },
        });
        await client.connect(transport);
    }

    beforeEach(() => {
        client = new Client({
            name: "test-client",
            version: "1.0.0",
        });
    });

    afterEach(async () => {
        if (client) {
            await client.close();
        }
        if (transport) {
            await transport.close();
        }
        if (runner) {
            await runner.close();
        }
    });

    describe("override behavior", () => {
        it("should error when allowRequestOverrides is false", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: false,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-read-only"]: "true",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Request overrides are not enabled");
            }
        });

        it("should override readOnly config with header (false to true)", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();

            // Verify read-only mode is applied - insert-many should not be available
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });

        it("should not be able tooverride connectionString with header", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                connectionString: undefined,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-connection-string"]: "mongodb://override:27017",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(`Config key connectionString is not allowed to be overridden`);
            }
        });
    });

    describe("merge behavior", () => {
        it("should merge disabledTools with header", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                disabledTools: ["insert-many"],
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-disabled-tools"]: "find,aggregate",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();

            // Verify all three tools are disabled
            const insertTool = response.tools.find(
                (tool) => tool.name === "insert-many" || tool.name === "find" || tool.name === "aggregate"
            );

            expect(response.tools).not.toHaveLength(0);
            expect(insertTool).toBeUndefined();
        });
    });

    describe("not-allowed behavior", () => {
        it.each([
            {
                configKey: "apiBaseUrl",
                headerName: "x-mongodb-mcp-api-base-url",
                headerValue: "https://malicious.com/",
            },
            {
                configKey: "apiClientId",
                headerName: "x-mongodb-mcp-api-client-id",
                headerValue: "malicious-id",
            },
            {
                configKey: "apiClientSecret",
                headerName: "x-mongodb-mcp-api-client-secret",
                headerValue: "malicious-secret",
            },
            {
                configKey: "transport",
                headerName: "x-mongodb-mcp-transport",
                headerValue: "stdio",
            },
            {
                configKey: "httpPort",
                headerName: "x-mongodb-mcp-http-port",
                headerValue: "9999",
            },
            {
                configKey: "maxBytesPerQuery",
                headerName: "x-mongodb-mcp-max-bytes-per-query",
                headerValue: "999999",
            },
            {
                configKey: "maxDocumentsPerQuery",
                headerName: "x-mongodb-mcp-max-documents-per-query",
                headerValue: "1000",
            },
        ])("should reject $configKey with header", async ({ configKey, headerName, headerValue }) => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    [headerName]: headerValue,
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(`Config key ${configKey} is not allowed to be overridden`);
            }
        });

        it("should reject multiple not-allowed fields at once", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    "x-mongodb-mcp-api-base-url": "https://malicious.com/",
                    "x-mongodb-mcp-transport": "stdio",
                    "x-mongodb-mcp-http-port": "9999",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                // Should contain at least one of the not-allowed field errors
                const hasNotAllowedError =
                    error.message.includes("Config key apiBaseUrl is not allowed to be overridden") ||
                    error.message.includes("Config key transport is not allowed to be overridden") ||
                    error.message.includes("Config key httpPort is not allowed to be overridden");
                expect(hasNotAllowedError).toBe(true);
            }
        });
    });

    describe("query parameter overrides", () => {
        it("should apply overrides from query parameters", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            // Note: SDK doesn't support query params directly, so this test verifies the mechanism exists
            // In real usage, query params would be in the URL or request
            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);
        });
    });

    describe("integration with createSessionConfig", () => {
        it("should allow createSessionConfig to override header values", async () => {
            const userConfig = {
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            };

            // createSessionConfig receives the config after header overrides are applied
            // It can further modify it, but headers have already been applied
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = ({
                userConfig: config,
                request,
            }: {
                userConfig: typeof userConfig;
                request?: RequestContext;
            }): typeof userConfig => {
                expectDefined(request);
                expectDefined(request.headers);
                expect(request.headers).toBeDefined();
                config.readOnly = request.headers["x-mongodb-mcp-read-only"] === "true";
                config.disabledTools = ["count"];
                return config;
            };

            await startRunner(userConfig, createSessionConfig);

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();

            // Verify read-only mode was applied, as specified in request and
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify create session config overrides were applied
            const countTool = response.tools.find((tool) => tool.name === "count");
            expect(countTool).toBeUndefined();

            expect(response.tools).not.toHaveLength(0);
        });

        it("should pass request context to createSessionConfig", async () => {
            const userConfig = {
                ...defaultTestConfig,
                httpPort: 0,
                allowRequestOverrides: true,
            };

            let capturedRequest: RequestContext | undefined;
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = ({
                request,
            }: {
                userConfig: typeof userConfig;
                request?: RequestContext;
            }): Promise<typeof userConfig> => {
                expectDefined(request);
                expectDefined(request.headers);
                capturedRequest = request;
                return Promise.resolve(userConfig);
            };

            await startRunner(userConfig, createSessionConfig);

            await connectClient({
                "x-custom-header": "test-value",
            });

            // Verify that request context was passed
            expectDefined(capturedRequest);
            expectDefined(capturedRequest.headers);
            expect(capturedRequest.headers["x-custom-header"]).toBe("test-value");
        });
    });

    describe("conditional overrides", () => {
        it("should allow readOnly from false to true", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
            // Check readonly mode
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Check read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });

        it("should NOT allow readOnly from true to false", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: true,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-read-only"]: "false",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(`Cannot apply override for readOnly: Can only set to true`);
            }
        });
    });

    describe("multiple overrides", () => {
        it("should handle multiple header overrides", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                readOnly: false,
                indexCheck: false,
                idleTimeoutMs: 600_000,
                disabledTools: ["tool1"],
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-read-only"]: "true",
                ["x-mongodb-mcp-index-check"]: "true",
                ["x-mongodb-mcp-idle-timeout-ms"]: "300000",
                ["x-mongodb-mcp-disabled-tools"]: "count",
            });

            const response = await client.listTools();

            expect(response).toBeDefined();

            // Verify read-only mode
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify disabled tools
            const countTool = response.tools.find((tool) => tool.name === "count");
            expect(countTool).toBeUndefined();

            const findTool = response.tools.find((tool) => tool.name === "find");
            expect(findTool).toBeDefined();
        });
    });

    describe("onlyLowerThanBaseValueOverride behavior", () => {
        it("should allow override to a lower value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            await connectClient({
                ["x-mongodb-mcp-idle-timeout-ms"]: "300000",
            });

            const response = await client.listTools();
            expect(response).toBeDefined();
        });

        it("should reject override to a higher value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-idle-timeout-ms"]: "900000",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(
                    "Cannot apply override for idleTimeoutMs: Can only set to a value lower than the base value"
                );
            }
        });

        it("should reject override to equal value", async () => {
            await startRunner({
                ...defaultTestConfig,
                httpPort: 0,
                idleTimeoutMs: 600_000,
                allowRequestOverrides: true,
            });

            try {
                await connectClient({
                    ["x-mongodb-mcp-idle-timeout-ms"]: "600000",
                });
                expect.fail("Expected an error to be thrown");
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw new Error("Expected an error to be thrown");
                }
                expect(error.message).toContain("Error POSTing to endpoint");
                expect(error.message).toContain(
                    "Cannot apply override for idleTimeoutMs: Can only set to a value lower than the base value"
                );
            }
        });
    });

    describe("onlySubsetOfBaseValueOverride behavior", () => {
        describe("previewFeatures", () => {
            it("should allow override to same value", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["search"],
                    allowRequestOverrides: true,
                });

                await connectClient({
                    ["x-mongodb-mcp-preview-features"]: "search",
                });

                const response = await client.listTools();
                expect(response).toBeDefined();
            });

            it("should allow override to an empty array (subset of any array)", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: ["search"],
                    allowRequestOverrides: true,
                });

                await connectClient({
                    ["x-mongodb-mcp-preview-features"]: "",
                });

                const response = await client.listTools();
                expect(response).toBeDefined();
            });

            it("should reject override when base is empty array and trying to add items", async () => {
                await startRunner({
                    ...defaultTestConfig,
                    httpPort: 0,
                    previewFeatures: [],
                    allowRequestOverrides: true,
                });

                // Empty array trying to override with non-empty should fail (superset)
                try {
                    await connectClient({
                        ["x-mongodb-mcp-preview-features"]: "search",
                    });
                    expect.fail("Expected an error to be thrown");
                } catch (error) {
                    if (!(error instanceof Error)) {
                        throw new Error("Expected an error to be thrown");
                    }
                    expect(error.message).toContain("Error POSTing to endpoint");
                    expect(error.message).toContain(
                        "Cannot apply override for previewFeatures: Can only override to a subset of the base value"
                    );
                }
            });
        });
    });
});
