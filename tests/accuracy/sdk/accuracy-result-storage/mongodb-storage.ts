import { Collection, MongoClient } from "mongodb";
import {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatus,
    AccuracyRunStatuses,
    ExpectedToolCall,
    LLMToolCall,
    ModelResponse,
    PromptResult,
} from "./result-storage.js";

// Omitting these as they might contain large chunk of texts
const OMITTED_MODEL_RESPONSE_FIELDS: (keyof ModelResponse)[] = ["messages", "text"];

// The LLMToolCalls and ExpectedToolCalls are expected to have mongodb operators
// nested in the objects. This interferes with the update operation that we do
// on the accuracy result document to save the model responses which is why we
// serialize them before saving and deserialize them on fetch.
type SavedAccuracyResult = Omit<AccuracyResult, "promptResults"> & {
    promptResults: SavedPromptResult[];
};

type SavedPromptResult = Omit<PromptResult, "expectedToolCalls" | "modelResponses"> & {
    expectedToolCalls: string;
    modelResponses: SavedModelResponse[];
};

type SavedModelResponse = Omit<ModelResponse, "llmToolCalls"> & {
    llmToolCalls: string;
};

export class MongoDBBasedResultStorage implements AccuracyResultStorage {
    private client: MongoClient;
    private resultCollection: Collection<SavedAccuracyResult>;

    constructor(connectionString: string, database: string, collection: string) {
        this.client = new MongoClient(connectionString);
        this.resultCollection = this.client.db(database).collection<SavedAccuracyResult>(collection);
    }

    async getAccuracyResult(commitSHA: string, runId?: string): Promise<AccuracyResult | null> {
        const filters: Partial<AccuracyResult> = runId
            ? { commitSHA, runId }
            : // Note that we use the `Done` status filter only when asked for
              // a commit. That is because the one use case of asking for a run
              // for commit is when you want the last successful run of that
              // particular commit.
              { commitSHA, runStatus: AccuracyRunStatus.Done };

        const result = await this.resultCollection.findOne(filters, {
            sort: {
                createdOn: -1,
            },
        });

        return result ? this.deserializeSavedResult(result) : result;
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
        const expectedToolCallsToSave = JSON.stringify(expectedToolCalls);
        const modelResponseToSave: SavedModelResponse = {
            ...modelResponse,
            llmToolCalls: JSON.stringify(modelResponse.llmToolCalls),
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
                                                        prompt,
                                                        expectedToolCalls: expectedToolCallsToSave,
                                                        modelResponses: [modelResponseToSave],
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
                                                            expectedToolCalls: expectedToolCallsToSave,
                                                            modelResponses: {
                                                                $concatArrays: [
                                                                    "$$promptResult.modelResponses",
                                                                    [modelResponseToSave],
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

    private deserializeSavedResult(result: SavedAccuracyResult): AccuracyResult {
        return {
            ...result,
            promptResults: result.promptResults.map<PromptResult>((result) => {
                return {
                    ...result,
                    expectedToolCalls: JSON.parse(result.expectedToolCalls) as ExpectedToolCall[],
                    modelResponses: result.modelResponses.map<ModelResponse>((response) => {
                        return {
                            ...response,
                            llmToolCalls: JSON.parse(response.llmToolCalls) as LLMToolCall[],
                        };
                    }),
                };
            }),
        };
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}
