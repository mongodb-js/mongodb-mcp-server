import type { Collection } from "mongodb";
import { MongoClient } from "mongodb";
import type {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatuses,
    ExpectedToolCall,
    ModelResponse,
} from "./resultStorage.js";
import { AccuracyRunStatus } from "./resultStorage.js";

// We could decide to omit some fields from the model response to reduce the size of the stored results. Since
// so far, the responses are not too big, we do not omit any fields, but if we decide to do so in the future,
// we could add `"messages"` and `"text"` to this list.
const OMITTED_MODEL_RESPONSE_FIELDS: (keyof ModelResponse)[] = [];

export class MongoDBBasedResultStorage implements AccuracyResultStorage {
    private client: MongoClient;
    private resultCollection: Collection<AccuracyResult>;

    constructor(connectionString: string, database: string, collection: string) {
        this.client = new MongoClient(connectionString);
        this.resultCollection = this.client.db(database).collection<AccuracyResult>(collection);
    }

    async getAccuracyResult(commitSHA: string, runId?: string): Promise<AccuracyResult | null> {
        const filters: Partial<AccuracyResult> = runId
            ? { commitSHA, runId }
            : // Note that we use the `Done` status filter only when asked for
              // a commit. That is because the one use case of asking for a run
              // for commit is when you want the last successful run of that
              // particular commit.
              { commitSHA, runStatus: AccuracyRunStatus.Done };

        return await this.resultCollection.findOne(filters, {
            sort: {
                createdOn: -1,
            },
        });
    }

    async updateRunStatus(commitSHA: string, runId: string, status: AccuracyRunStatuses): Promise<void> {
        await this.resultCollection.updateOne(
            { commitSHA, runId },
            {
                $set: {
                    runStatus: status,
                },
            }
        );
    }

    async saveModelResponseForPrompt({
        commitSHA,
        runId,
        prompt,
        expectedToolCalls,
        modelResponse,
    }: {
        commitSHA: string;
        runId: string;
        prompt: string;
        expectedToolCalls: ExpectedToolCall[];
        modelResponse: ModelResponse;
    }): Promise<void> {
        const modelResponseToSave: ModelResponse = {
            ...modelResponse,
        };

        for (const field of OMITTED_MODEL_RESPONSE_FIELDS) {
            delete modelResponseToSave[field];
        }

        await this.resultCollection.updateOne(
            { commitSHA, runId },
            [
                {
                    $set: {
                        runStatus: { $ifNull: ["$runStatus", AccuracyRunStatus.InProgress] },
                        createdOn: { $ifNull: ["$createdOn", Date.now()] },
                        commitSHA: { $ifNull: ["$commitSHA", commitSHA] },
                        runId: { $ifNull: ["$runId", runId] },
                        promptResults: {
                            $ifNull: ["$promptResults", []],
                        },
                    },
                },
                {
                    $set: {
                        promptResults: {
                            $let: {
                                vars: {
                                    existingPromptIndex: {
                                        $indexOfArray: ["$promptResults.prompt", prompt],
                                    },
                                },
                                in: {
                                    $cond: [
                                        { $eq: ["$$existingPromptIndex", -1] },
                                        {
                                            $concatArrays: [
                                                "$promptResults",
                                                [
                                                    {
                                                        $literal: {
                                                            prompt,
                                                            expectedToolCalls,
                                                            modelResponses: [modelResponseToSave],
                                                        },
                                                    },
                                                ],
                                            ],
                                        },
                                        {
                                            $map: {
                                                input: "$promptResults",
                                                as: "promptResult",
                                                in: {
                                                    $cond: [
                                                        { $eq: ["$$promptResult.prompt", prompt] },
                                                        {
                                                            prompt: "$$promptResult.prompt",
                                                            expectedToolCalls: {
                                                                $literal: expectedToolCalls,
                                                            },
                                                            modelResponses: {
                                                                $concatArrays: [
                                                                    "$$promptResult.modelResponses",
                                                                    [{ $literal: modelResponseToSave }],
                                                                ],
                                                            },
                                                        },
                                                        "$$promptResult",
                                                    ],
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            ],
            { upsert: true }
        );
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}
