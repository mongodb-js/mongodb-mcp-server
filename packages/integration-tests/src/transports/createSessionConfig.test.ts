import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { UserConfig, CliServer } from "mongodb-mcp-server";
import { defaultTestConfig, expectDefined } from "../integrationHelpers.js";
import { sleep } from "@mongodb-js/mcp-core";
import { createTestServer } from "../helpers/createTestServer.js";
import { createStreamableHttpTestRunner } from "../helpers/streamableHttpTestRunner.js";

// Helper to create StreamableHttpRunner with config modification
function createConfigModifyingRunner(
    baseConfig: UserConfig,
    configModifier: (config: UserConfig) => Promise<UserConfig>
): {
    runner: StreamableHttpRunner<CliServer>;
    getServerAddress: () => string;
} {
    return createStreamableHttpTestRunner(baseConfig, {
        createServer: async (config) => createTestServer(await configModifier(config)),
    });
}

describe("createSessionConfig (via createServerForRequest override)", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;
    let getServerAddress: () => string;

    afterEach(async () => {
        if (client) {
            await client.close();
            client = undefined;
        }
        if (transport) {
            await transport.close();
            transport = undefined;
        }
        if (runner) {
            await runner.close();
        }
    });

    describe("basic functionality", () => {
        it("should use the modified config from configModifier", async () => {
            const result = createConfigModifyingRunner(defaultTestConfig, async (config) =>
                Promise.resolve({
                    ...config,
                    apiBaseUrl: "https://test-api.mongodb.com/",
                })
            );
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
            expectDefined(response);
            expect(response.tools).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);
        });

        it("should work with the default config", async () => {
            const result = createConfigModifyingRunner(defaultTestConfig, (config) => Promise.resolve(config));
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
            expectDefined(response);
            expect(response.tools).toBeDefined();
        });
    });

    describe("server integration", () => {
        it("should successfully initialize server with modified config and serve requests", async () => {
            const result = createConfigModifyingRunner(defaultTestConfig, async (config) => {
                // Simulate async config modification
                await sleep(10);
                return {
                    ...config,
                    readOnly: true, // Enable read-only mode
                };
            });
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
            expectDefined(response);

            expect(response.tools).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);

            // Verify read-only mode is applied - insert-many should not be available
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });
    });

    describe("error handling", () => {
        it("should propagate errors from configModifier on client connection", async () => {
            const result = createConfigModifyingRunner(defaultTestConfig, async () => {
                return Promise.reject(new Error("Failed to fetch config"));
            });
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            // Error should occur when a client tries to connect
            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));

            await expect(client.connect(transport)).rejects.toThrow();
        });
    });
});
