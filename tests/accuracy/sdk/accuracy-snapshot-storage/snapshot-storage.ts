import z from "zod";

const ExpectedToolCallSchema = z.object({
    toolCallId: z.string(),
    toolName: z.string(),
    parameters: z.record(z.string(), z.unknown()),
});

const ActualToolCallSchema = ExpectedToolCallSchema.omit({ toolCallId: undefined });

export type ExpectedToolCall = z.infer<typeof ExpectedToolCallSchema>;
export type ActualToolCall = z.infer<typeof ActualToolCallSchema>;

export const AccuracySnapshotEntrySchema = z.object({
    // Git and meta information for snapshot entries
    accuracyRunId: z.string(),
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

    getLatestSnapshotsForCommit(commit: string): Promise<AccuracySnapshotEntry[]>;

    close(): Promise<void>;
}
