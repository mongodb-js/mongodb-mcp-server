import { ModelFacade, ToolCall, ToolDefinition } from "./model.js";

type GeminiModel = "gemini-2.0-flash" | "gemini-1.5-flash";

export class GeminiModelFacade implements ModelFacade {
    readonly name: GeminiModel;

    constructor(modelName: GeminiModel) {
        this.name = modelName;
    }

    available(): boolean {
        return process.env.MONGODB_MCP_TEST_GEMINI_API_KEY !== undefined;
    }

    async generateContent(prompt: string, tools: ToolDefinition[]): Promise<{ toolCall: ToolCall[]; text?: string }> {
        const toolDefinitions = tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || {},
        }));

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = {
            contents: chatHistory,
            tools: {
                function_declarations: [toolDefinitions],
            },
        };

        const apiKey = process.env.MONGODB_MCP_TEST_GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.name}:generateContent?key=${apiKey}`;

        try {
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error(`[Gemini API Error] HTTP error! status: ${response.status}, data: ${errorData}`);
                return { toolCall: [], text: `Gemini API error: ${response.status}` };
            }

            const result = (await response.json()) as {
                candidates: Array<{
                    content: {
                        parts: Array<{
                            text?: string;
                            functionCall?: {
                                name: string;
                                args: Record<string, unknown>;
                            };
                        }>;
                    };
                }>;
            };

            if (result.candidates && result.candidates.length > 0) {
                const firstPart = result.candidates[0]?.content.parts[0];
                if (firstPart?.functionCall) {
                    return {
                        toolCall: [
                            {
                                name: firstPart.functionCall.name,
                                args: firstPart.functionCall.args,
                            },
                        ],
                    };
                } else if (firstPart?.text) {
                    return { toolCall: [], text: firstPart.text };
                }
            }
            return { toolCall: [], text: "Gemini response was empty or unexpected." };
        } catch (error: unknown) {
            console.error("[Gemini API Fetch Error]", error);
            return { toolCall: [], text: `Error contacting Gemini LLM.` };
        }
    }
}
