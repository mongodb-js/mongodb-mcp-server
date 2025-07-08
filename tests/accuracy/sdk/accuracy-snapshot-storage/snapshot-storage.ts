import z from "zod";

export const AccuracySnapshotEntrySchema = z.object({
    // Git and meta information for snapshot entries
    accuracyRunId: z.string(),
    createdOn: z.number(),
    commitSHA: z.string(),
    // Accuracy info
    requestedModel: z.string(),
    test: z.string(),
    prompt: z.string(),
    toolCallingAccuracy: z.number(),
    parameterAccuracy: z.number(),
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
            | "requestedModel"
            | "test"
            | "prompt"
            | "toolCallingAccuracy"
            | "parameterAccuracy"
            | "llmResponseTime"
            | "tokensUsage"
            | "respondingModel"
            | "text"
            | "messages"
        >
    ): Promise<void>;

    getLastRunIdForCommit(commit: string): Promise<string | undefined>;

    getSnapshotEntriesForRunId(accuracyRunId: string): Promise<AccuracySnapshotEntry[]>;

    close(): Promise<void>;
}
