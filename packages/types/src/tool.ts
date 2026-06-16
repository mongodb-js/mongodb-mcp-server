export type OperationType = "metadata" | "read" | "create" | "delete" | "update" | "connect";

export type ToolCategory = "mongodb" | "atlas" | "atlas-local" | "assistant";

export type ToolExecutionContext = {
    signal: AbortSignal;
    requestInfo?: {
        headers?: Record<string, unknown>;
    };
};

export type ToolClass<TParams extends unknown[] = unknown[]> = {
    new (params: TParams): {
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
