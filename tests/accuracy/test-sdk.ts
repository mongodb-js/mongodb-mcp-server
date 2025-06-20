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

type ToolMockReturn = { content: Array<{ type: string; text: string }> };
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

    thenReturn(value: ToolMockReturn): this {
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

type NonMockedCallError = { tool: string; args: unknown };

function logVerbose(...args: unknown[]): void {
    if (process.env.MONGODB_MCP_TEST_VERBOSE === "true") {
        console.log(...args);
    }
}

function printModelPlanIfVerbose(model: string, plan: string[]): void {
    logVerbose(model, "📝: ", plan.join("\n"));
}

function testPromptIsVerbose(model: string, prompt: string): void {
    logVerbose(model, "📜: ", prompt);
}

function modelSaidVerbose(model: string, response: string): void {
    if (response.length > 0) {
        logVerbose(model, "🗣️: ", response);
    }
}

function modelToolCalledVerbose(model: string, toolCall: string, args: unknown): void {
    logVerbose(model, "🛠️: ", toolCall, JSON.stringify(args));
}

function toolCallsReturnedVerbose(model: string, answer: string): void {
    logVerbose(model, "📋: ", answer);
}

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
                    testPromptIsVerbose(model.name, prompt);

                    const mcpServerUnsafe = (mcpServer as unknown as McpServerUnsafe).mcpServer;
                    const tools = mcpServerUnsafe["_registeredTools"] as { [toolName: string]: RegisteredTool };
                    const mockedTools = new Set<string>();
                    const nonMockedCallErrors = new Array<NonMockedCallError>();

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

                    const plan = await model.generatePlan(prompt, toolDefinitions);
                    printModelPlanIfVerbose(model.name, plan);


                   const mocks: Array<ToolMock> = [];
                    const toolFn: AccuracyToolSetupFunction = (toolName: string) => {
                        const mock = new ToolMock(toolName);
                        mockedTools.add(toolName);

                        const mcpServerUnsafe = (mcpServer as unknown as McpServerUnsafe).mcpServer;
                        const tools = mcpServerUnsafe["_registeredTools"] as { [toolName: string]: RegisteredTool };

                        if (tools[toolName] !== undefined) {
                            tools[toolName].callback = ((args: unknown) => {
                                mock._wasCalledWith(args);
                                return Promise.resolve(mock.returns);
                            }) as unknown as ToolCallback;
                        }

                        mocks.push(mock);
                        return mock;
                    };

                    testCase(toolFn);

                    const consumePromptUntilNoMoreCall = async (prompt: string[]) => {
                        const response = await model.generateContent(prompt, toolDefinitions);

                        modelSaidVerbose(model.name, response.text || "<no text>");
                        if (response.toolCall.length > 0) {
                            const toolCallResults = await Promise.all(
                                response.toolCall.map((tc) => {
                                    modelToolCalledVerbose(model.name, tc.name, tc.args);

                                    if (!mockedTools.has(tc.name)) {
                                        nonMockedCallErrors.push({ tool: tc.name, args: tc.args });
                                    }

                                    return mcpClient.callTool({
                                        name: tc.name,
                                        arguments: tc.args,
                                    });
                                })
                            );

                            const responseParts = toolCallResults.flatMap((result) =>
                                (result.content as Array<{ text: string }>).map((c) => c.text)
                            );

                            const newPrompt = prompt.concat(responseParts);
                            toolCallsReturnedVerbose(model.name, newPrompt.join("\n"));

                            if (responseParts.length > 0) {
                                return consumePromptUntilNoMoreCall(newPrompt);
                            }
                        }
                    };

                    for (const step of plan) {
                        await consumePromptUntilNoMoreCall([ step ]);
                    }
                    
                    await consumePromptUntilNoMoreCall([prompt]);

                    mocks.forEach((mock) => mock._verify());
                    if (nonMockedCallErrors.length > 0) {
                        for (const call of nonMockedCallErrors) {
                            console.error(
                                `Non-mocked tool call detected: ${call.tool} with args:`,
                                JSON.stringify(call.args, null, 2)
                            );
                        }

                        throw new Error("Non-mocked tool calls detected. Check the console for details.");
                    }
                });
            };

            testCaseFn({ prompt: promptFn });
        });
    });
}
