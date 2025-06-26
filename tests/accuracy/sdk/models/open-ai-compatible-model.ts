import OpenAI, { ClientOptions } from "openai";
import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { Model } from "./model.js";
import { TestMCPClient } from "../test-mcp-client.js";

const BASIC_SYSTEM_PROMPT =
    "Only respond with a tool call in valid JSON format when a tool is required. Do not include any other text or explanation.";

const MAX_CONVERSATION_LOOPS = 3;

export class OpenAICompatibleModel implements Model<OpenAI.ChatCompletionTool> {
    private openAI: OpenAI;
    constructor(
        private readonly model: string,
        options: ClientOptions
    ) {
        this.openAI = new OpenAI(options);
    }

    transformMCPTool(tool: MCPTool): OpenAI.ChatCompletionTool {
        return {
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        };
    }

    async chat(prompt: string, mcpClient: TestMCPClient, systemPrompt: string = BASIC_SYSTEM_PROMPT) {
        return await this.chatLoop(
            [
                {
                    role: "system",
                    content: systemPrompt,
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            mcpClient.listTools().map((tool) => this.transformMCPTool(tool)),
            mcpClient
        );
    }

    private async chatLoop(
        messages: OpenAI.ChatCompletionMessageParam[],
        tools: OpenAI.ChatCompletionTool[],
        mcpClient: TestMCPClient,
        loopCount: number = 1
    ): Promise<OpenAI.ChatCompletionMessageParam[]> {
        if (loopCount > MAX_CONVERSATION_LOOPS) {
            return messages;
        }

        const chatLoopHistory = [...messages];
        const response = await this.openAI.chat.completions.create({
            model: this.model,
            messages: messages,
            tools: tools,
            n: 1,
        });
        const message = response.choices[0]?.message;
        if (!message) {
            return chatLoopHistory;
        }

        chatLoopHistory.push(message);
        if (!message.tool_calls?.length) {
            return chatLoopHistory;
        }

        for (const toolCall of message.tool_calls) {
            const toolResult = mcpClient.callTool(
                toolCall.function.name,
                this.safeJSONParse(toolCall.function.arguments)
            );

            const toolResponseContents: OpenAI.ChatCompletionContentPartText[] = [];
            for (const content of toolResult.content) {
                if (content.type === "text") {
                    toolResponseContents.push(content);
                }
            }
            if (toolResponseContents.length) {
                chatLoopHistory.push({
                    role: "tool",
                    content: toolResponseContents,
                    tool_call_id: toolCall.id,
                });
            }
        }

        return await this.chatLoop(chatLoopHistory, tools, mcpClient, loopCount + 1);
    }

    private safeJSONParse(jsonString: string): unknown {
        try {
            return JSON.parse(jsonString) as unknown;
        } catch {
            return { error: "Could not parse JSON argument", received: jsonString };
        }
    }

    toString() {
        return `OAI Compatible: ${this.model}`;
    }
}
