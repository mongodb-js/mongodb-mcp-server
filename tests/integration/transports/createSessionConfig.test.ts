import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { TransportRunnerConfig } from "../../../src/lib.js";
import { defaultTestConfig } from "../helpers.js";

describe("createSessionConfig", () => {
    const userConfig = defaultTestConfig;
    let runner: StreamableHttpRunner;

    describe("basic functionality", () => {
        it("should use the modified config from createSessionConfig", async () => {
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = async (userConfig) => {
                return {
                    ...userConfig,
                    apiBaseUrl: "https://test-api.mongodb.com/",
                };
            };

            userConfig.httpPort = 0; // Use a random port
            runner = new StreamableHttpRunner({
                userConfig,
                createSessionConfig,
            });
            await runner.start();

            const server = await runner["setupServer"]();
            expect(server.userConfig.apiBaseUrl).toBe("https://test-api.mongodb.com/");

            await runner.close();
        });

        it("should work without a createSessionConfig", async () => {
            userConfig.httpPort = 0; // Use a random port
            runner = new StreamableHttpRunner({
                userConfig,
            });
            await runner.start();

            const server = await runner["setupServer"]();
            expect(server.userConfig.apiBaseUrl).toBe(userConfig.apiBaseUrl);

            await runner.close();
        });
    });

    describe("connection string modification", () => {
        it("should allow modifying connection string via createSessionConfig", async () => {
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = async (userConfig) => {
                // Simulate fetching connection string from environment or secrets
                await new Promise((resolve) => setTimeout(resolve, 10));

                return {
                    ...userConfig,
                    connectionString: "mongodb://test-server:27017/test-db",
                };
            };

            userConfig.httpPort = 0; // Use a random port
            runner = new StreamableHttpRunner({
                userConfig: { ...userConfig, connectionString: undefined },
                createSessionConfig,
            });
            await runner.start();

            const server = await runner["setupServer"]();
            expect(server.userConfig.connectionString).toBe("mongodb://test-server:27017/test-db");

            await runner.close();
        });
    });

    describe("server integration", () => {
        let client: Client;
        let transport: StreamableHTTPClientTransport;

        it("should successfully initialize server with createSessionConfig and serve requests", async () => {
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = async (userConfig) => {
                // Simulate async config modification
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    ...userConfig,
                    readOnly: true, // Enable read-only mode
                };
            };

            userConfig.httpPort = 0; // Use a random port
            runner = new StreamableHttpRunner({
                userConfig,
                createSessionConfig,
            });
            await runner.start();

            client = new Client({
                name: "test-client",
                version: "1.0.0",
            });
            transport = new StreamableHTTPClientTransport(new URL(`${runner.serverAddress}/mcp`));

            await client.connect(transport);
            const response = await client.listTools();

            expect(response).toBeDefined();
            expect(response.tools).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);

            // Verify read-only mode is applied - insert-one should not be available
            const writeTools = response.tools.filter((tool) => tool.name === "insert-one");
            expect(writeTools.length).toBe(0);

            // Verify read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);

            await client.close();
            await transport.close();
            await runner.close();
        });
    });

    describe("error handling", () => {
        it("should propagate errors from configProvider on client connection", async () => {
            const createSessionConfig: TransportRunnerConfig["createSessionConfig"] = async () => {
                throw new Error("Failed to fetch config");
            };

            userConfig.httpPort = 0; // Use a random port
            runner = new StreamableHttpRunner({
                userConfig,
                createSessionConfig,
            });

            // Start succeeds because setupServer is only called when a client connects
            await runner.start();

            // Error should occur when a client tries to connect
            const testClient = new Client({
                name: "test-client",
                version: "1.0.0",
            });
            const testTransport = new StreamableHTTPClientTransport(new URL(`${runner.serverAddress}/mcp`));

            await expect(testClient.connect(testTransport)).rejects.toThrow();

            await testClient.close();
            await testTransport.close();

            await runner.close();
        });
    });
});
