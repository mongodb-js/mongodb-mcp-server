export type ToolCall = { name: string; args: Record<string, unknown> };
export type ToolDefinition = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
};

export interface ModelFacade {
    name: string;
    available(): boolean;
    generateContent(prompt: string, tools: ToolDefinition[]): Promise<{ toolCall: ToolCall[]; text?: string }>;
}
