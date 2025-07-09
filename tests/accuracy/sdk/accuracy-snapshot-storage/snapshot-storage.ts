import z from "zod";

const ExpectedToolCallSchema = z.object({
    toolName: z.string(),
    parameters: z.record(z.string(), z.unknown()),
});
export type ExpectedToolCall = z.infer<typeof ExpectedToolCallSchema>;

const ActualToolCallSchema = ExpectedToolCallSchema.extend({ toolCallId: z.string() });
export type ActualToolCall = z.infer<typeof ActualToolCallSchema>;

export const AccuracyRunStatus = {
    Done: "done",
    Failed: "failed",
    InProgress: "in-progress",
} as const;

export type AccuracyRunStatuses = (typeof AccuracyRunStatus)[keyof typeof AccuracyRunStatus];

export const AccuracySnapshotEntrySchema = z.object({
    // Git and meta information for snapshot entries
    accuracyRunId: z.string(),
    accuracyRunStatus: z
        .enum([AccuracyRunStatus.Done, AccuracyRunStatus.Failed, AccuracyRunStatus.InProgress])
        .default(AccuracyRunStatus.InProgress),
    createdOn: z.number(),
    commitSHA: z.string(),
    // Accuracy info
    provider: z.string(),
    requestedModel: z.string(),
    test: z.string(),
    prompt: z.string(),
    toolCallingAccuracy: z.number(),
    // debug info for further investigations
    expectedToolCalls: ExpectedToolCallSchema.array(),
    actualToolCalls: ActualToolCallSchema.array(),
    llmResponseTime: z.number(),
    tokensUsage: z
        .object({
            promptTokens: z.number().optional(),
            completionTokens: z.number().optional(),
            totalTokens: z.number().optional(),
        })
        .optional(),
    respondingModel: z.string(),
    text: z.string(),
    messages: z.array(z.record(z.string(), z.unknown())),
});

export type AccuracySnapshotEntry = z.infer<typeof AccuracySnapshotEntrySchema>;

export interface AccuracySnapshotStorage {
    createSnapshotEntry(
        snapshotEntry: Pick<
            AccuracySnapshotEntry,
            | "accuracyRunId"
            | "commitSHA"
            | "provider"
            | "requestedModel"
            | "test"
            | "prompt"
            | "toolCallingAccuracy"
            | "expectedToolCalls"
            | "actualToolCalls"
            | "llmResponseTime"
            | "tokensUsage"
            | "respondingModel"
            | "text"
            | "messages"
        >
    ): Promise<void>;

    getLatestSnapshotForCommit(commit: string): Promise<AccuracySnapshotEntry[]>;

    getSnapshotForAccuracyRun(accuracyRunId: string): Promise<AccuracySnapshotEntry[]>;

    updateAccuracyRunStatus(accuracyRunId: string, status: AccuracyRunStatuses): Promise<void>;

    close(): Promise<void>;
}
