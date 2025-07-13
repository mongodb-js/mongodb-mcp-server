import { Collection, MongoClient } from "mongodb";
import {
    AccuracyResult,
    AccuracyResultStorage,
    AccuracyRunStatus,
    AccuracyRunStatuses,
    ModelResponse,
} from "./result-storage.js";

export class MongoDBBasedResultStorage implements AccuracyResultStorage {
    private client: MongoClient;
    private resultCollection: Collection<AccuracyResult>;

    constructor(
        connectionString: string,
        // Omitting these as they might contain large chunk of texts
        private readonly omittedModelResponseFields: (keyof ModelResponse)[] = ["messages", "text"]
    ) {
        this.client = new MongoClient(connectionString);
        this.resultCollection = this.client.db("mongodb-mcp-server").collection<AccuracyResult>("accuracy-results");
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

    async saveModelResponseForPrompt(
        commitSHA: string,
        runId: string,
        prompt: string,
        modelResponse: ModelResponse
    ): Promise<void> {
        const savedModelResponse: ModelResponse = { ...modelResponse };
        for (const field of this.omittedModelResponseFields) {
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
                    promptResults: { prompt, modelResponses: [] },
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

    async close(): Promise<void> {
        await this.client.close();
    }
}
