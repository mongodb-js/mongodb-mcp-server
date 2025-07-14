import { Collection, MongoClient } from "mongodb";
import {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatus,
    AccuracyRunStatuses,
    ExpectedToolCall,
    ModelResponse,
} from "./result-storage.js";

// Omitting these as they might contain large chunk of texts
const OMITTED_MODEL_RESPONSE_FIELDS: (keyof ModelResponse)[] = ["messages", "text"];

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
        const savedModelResponse: ModelResponse = { ...modelResponse };
        for (const field of OMITTED_MODEL_RESPONSE_FIELDS) {
            delete savedModelResponse[field];
        }

        await this.resultCollection.updateOne(
            { commitSHA, runId },
            {
                $setOnInsert: {
                    runStatus: AccuracyRunStatus.InProgress,
                    createdOn: Date.now(),
                    commitSHA,
                    runId,
                    promptResults: [],
                },
            },
            { upsert: true }
        );

        await this.resultCollection.updateOne(
            {
                commitSHA,
                runId,
                "promptResults.prompt": { $ne: prompt },
            },
            {
                $push: {
                    promptResults: { prompt, expectedToolCalls, modelResponses: [] },
                },
            }
        );

        await this.resultCollection.updateOne(
            { commitSHA, runId },
            {
                $push: {
                    "promptResults.$[promptElement].modelResponses": savedModelResponse,
                },
            },
            {
                arrayFilters: [{ "promptElement.prompt": prompt }],
            }
        );
    }

    async saveModelResponseForPromptAtomic({
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
        const savedModelResponse: ModelResponse = { ...modelResponse };
        for (const field of OMITTED_MODEL_RESPONSE_FIELDS) {
            delete savedModelResponse[field];
        }

        await this.resultCollection.updateOne(
            { commitSHA, runId },
            [
                {
                    $set: {
                        runStatus: {
                            $ifNull: ["$runStatus", AccuracyRunStatus.InProgress],
                        },
                        createdOn: {
                            $ifNull: ["$createdOn", Date.now()],
                        },
                        commitSHA: commitSHA,
                        runId: runId,
                        promptResults: {
                            $let: {
                                vars: {
                                    existingPrompts: { $ifNull: ["$promptResults", []] },
                                    promptExists: {
                                        $in: [
                                            prompt,
                                            {
                                                $ifNull: [
                                                    { $map: { input: "$promptResults", as: "pr", in: "$$pr.prompt" } },
                                                    [],
                                                ],
                                            },
                                        ],
                                    },
                                },
                                in: {
                                    $map: {
                                        input: {
                                            $cond: {
                                                if: "$$promptExists",
                                                then: "$$existingPrompts",
                                                else: {
                                                    $concatArrays: [
                                                        "$$existingPrompts",
                                                        [{ prompt, expectedToolCalls, modelResponses: [] }],
                                                    ],
                                                },
                                            },
                                        },
                                        as: "promptResult",
                                        in: {
                                            $cond: {
                                                if: { $eq: ["$$promptResult.prompt", prompt] },
                                                then: {
                                                    prompt: "$$promptResult.prompt",
                                                    expectedToolCalls: "$$promptResult.expectedToolCalls",
                                                    modelResponses: {
                                                        $concatArrays: [
                                                            "$$promptResult.modelResponses",
                                                            [savedModelResponse],
                                                        ],
                                                    },
                                                },
                                                else: "$$promptResult",
                                            },
                                        },
                                    },
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
