export type OperationType = "metadata" | "read" | "create" | "delete" | "update" | "connect";

export type ToolCategory = "mongodb" | "atlas" | "atlas-local" | "assistant";

export type ToolExecutionContext = {
    signal: AbortSignal;
    requestInfo?: {
        headers?: Record<string, unknown>;
    };
};

export type ToolClass = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (params: any): {
        name: string;
        category: ToolCategory;
        operationType: OperationType;
    };
    toolName: string;
    category: ToolCategory;
    operationType: OperationType;
};

export interface IToolRegistrar {
    register(tool: ToolClass): boolean;
}
