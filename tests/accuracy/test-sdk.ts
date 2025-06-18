import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer, RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "../../src/server.js";
import { Session } from "../../src/session.js";
import { Telemetry } from "../../src/telemetry/telemetry.js";
import { config, UserConfig } from "../../src/config.js";
import { afterEach } from "node:test";
import { availableModels } from "./models/index.js";
import { ToolDefinition } from "./models/model.js";
import { zodToJsonSchema } from "zod-to-json-schema";

class ToolMock {
    readonly name: string;
    arguments: unknown;
    returns: unknown;
    wasCalledWith: unknown;

    constructor(name: string) {
        this.name = name;
        this.arguments = {};
        this.returns = {};
    }

    verifyCalled(args: unknown): this {
        this.arguments = args;
        return this;
    }

    thenReturn(value: unknown): this {
        this.returns = value;
        return this;
    }

    _wasCalledWith(args: unknown): this {
        this.wasCalledWith = args;
        return this;
    }

    _verify(): void {
        if (this.wasCalledWith) {
            expect(this.wasCalledWith).toEqual(this.arguments);
        } else {
            expect(this.arguments).not.toBe(null);
        }
    }
}

interface McpServerUnsafe {
    mcpServer: McpServer;
}

type AccuracyToolSetupFunction = (toolName: string) => ToolMock;
type AccuracyTestCaseFn = (tools: AccuracyToolSetupFunction) => void;
type AccuracyItFn = (prompt: string, testCase: AccuracyTestCaseFn) => void;
type AccuracyTestSuite = { prompt: AccuracyItFn };

export function describeAccuracyTest(useCase: string, testCaseFn: (testSuite: AccuracyTestSuite) => void) {
    const models = availableModels();
    if (models.length === 0) {
        throw new Error("No models available for accuracy tests.");
    }

    models.forEach((model) => {
        describe(`${model.name}: ${useCase}`, () => {
            let mcpServer: Server;
            let mcpClient: Client;
            let userConfig: UserConfig;
            let session: Session;
            let telemetry: Telemetry;

            beforeEach(async () => {
                mcpClient = new Client(
                    {
                        name: "test-client",
                        version: "1.2.3",
                    },
                    {
                        capabilities: {},
                    }
                );

                userConfig = { ...config };
                session = new Session(userConfig);
                telemetry = Telemetry.create(session, userConfig);

                mcpServer = new Server({
                    session,
                    userConfig,
                    telemetry,
                    mcpServer: new McpServer({
                        name: "test-server",
                        version: "5.2.3",
                    }),
                });

                const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

                await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
            });

            afterEach(async () => {
                await Promise.all([mcpServer.close(), mcpClient.close()]);
            });

            const promptFn: AccuracyItFn = (prompt: string, testCase: AccuracyTestCaseFn) => {
                it(prompt, async () => {
                    const mcpServerUnsafe = (mcpServer as unknown as McpServerUnsafe).mcpServer;
                    const tools = mcpServerUnsafe["_registeredTools"] as { [toolName: string]: RegisteredTool };
                    const toolDefinitions = Object.entries(tools).map(([toolName, tool]) => {
                        if (!tool.inputSchema) {
                            throw new Error(`Tool ${toolName} does not have an input schema defined.`);
                        }

                        const toolForApi: ToolDefinition = {
                            name: toolName,
                            description: tool.description ?? "",
                            parameters: zodToJsonSchema(tool.inputSchema, {
                                target: "jsonSchema7",
                                allowedAdditionalProperties: undefined,
                                rejectedAdditionalProperties: undefined,
                                postProcess: (schema) => {
                                    if (schema && typeof schema === "object") {
                                        return {
                                            ...schema,
                                            $schema: undefined,
                                            const: undefined,
                                            additionalProperties: undefined,
                                        };
                                    }
                                    return schema;
                                },
                            }),
                        };
                        delete toolForApi.parameters.$schema;
                        return toolForApi;
                    });

                    const mocks: Array<ToolMock> = [];
                    const toolFn: AccuracyToolSetupFunction = (toolName: string) => {
                        const mock = new ToolMock(toolName);

                        const mcpServerUnsafe = (mcpServer as unknown as McpServerUnsafe).mcpServer;
                        const tools = mcpServerUnsafe["_registeredTools"] as { [toolName: string]: RegisteredTool };

                        if (tools[toolName] !== undefined) {
                            tools[toolName].callback = ((args: unknown) => {
                                mock._wasCalledWith(args);
                                return mock.returns;
                            }) as unknown as ToolCallback;
                        }

                        mocks.push(mock);
                        return mock;
                    };

                    testCase(toolFn);

                    const consumePromptUntilNoMoreCall = async (prompt: string[]) => {
                        const promptStr = prompt.join("\n");
                        const response = await model.generateContent(promptStr, toolDefinitions);

                        if (response.toolCall.length > 0) {
                            const toolCallResults = await Promise.all(
                                response.toolCall.map((tc) =>
                                    mcpClient.callTool({
                                        name: tc.name,
                                        arguments: tc.args,
                                    })
                                )
                            );
                            const newPrompt = toolCallResults.flatMap((result) =>
                                (result.content as Array<{ text: string }>).map((c) => c.text)
                            );

                            if (newPrompt.join("\n").trim().length > 0) {
                                return consumePromptUntilNoMoreCall(newPrompt);
                            }
                        }
                    };

                    await consumePromptUntilNoMoreCall([prompt]);
                    mocks.forEach((mock) => mock._verify());
                });
            };

            testCaseFn({ prompt: promptFn });
        });
    });
}
