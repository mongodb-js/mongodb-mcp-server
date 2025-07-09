import { Collection, MongoClient } from "mongodb";
import {
    AccuracyRunStatus,
    AccuracyRunStatuses,
    AccuracySnapshotEntry,
    AccuracySnapshotEntrySchema,
    AccuracySnapshotStorage,
} from "./snapshot-storage.js";

export class MongoDBSnapshotStorage implements AccuracySnapshotStorage {
    private readonly client: MongoClient;
    private readonly snapshotCollection: Collection;
    private constructor({
        mongodbUrl,
        database,
        collection,
    }: {
        mongodbUrl: string;
        database: string;
        collection: string;
    }) {
        this.client = new MongoClient(mongodbUrl);
        this.snapshotCollection = this.client.db(database).collection(collection);
    }

    async createSnapshotEntry(
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
    ): Promise<void> {
        const snapshotWithMeta: AccuracySnapshotEntry = {
            ...snapshotEntry,
            accuracyRunStatus: AccuracyRunStatus.InProgress,
            createdOn: Date.now(),
        };
        await this.snapshotCollection.insertOne(snapshotWithMeta);
    }

    async getLatestSnapshotForCommit(commit: string): Promise<AccuracySnapshotEntry[]> {
        const latestRunId = await this.getLatestAccuracyRunForCommit(commit);
        return latestRunId ? this.getSnapshotForAccuracyRun(latestRunId) : [];
    }

    async getSnapshotForAccuracyRun(accuracyRunId: string): Promise<AccuracySnapshotEntry[]> {
        const snapshotEntries = await this.snapshotCollection.find({ accuracyRunId }).toArray();
        return AccuracySnapshotEntrySchema.array().parse(snapshotEntries);
    }

    private async getLatestAccuracyRunForCommit(commit: string): Promise<string | undefined> {
        const document = await this.snapshotCollection.findOne(
            { commit: commit, accuracyRunStatus: AccuracyRunStatus.Done },
            { sort: { createdOn: -1 }, projection: { accuracyRunId: 1 } }
        );

        return document?.accuracyRunId ? `${document?.accuracyRunId}` : undefined;
    }

    async updateAccuracyRunStatus(accuracyRunId: string, status: AccuracyRunStatuses) {
        await this.snapshotCollection.updateMany(
            { accuracyRunId: accuracyRunId },
            { $set: { accuracyRunStatus: status } }
        );
    }

    async close(): Promise<void> {
        await this.client.close();
    }

    static getStorage(): MongoDBSnapshotStorage | null {
        const mongodbUrl = process.env.MDB_ACCURACY_MDB_URL;
        const database = process.env.MDB_ACCURACY_MDB_DB;
        const collection = process.env.MDB_ACCURACY_MDB_COLLECTION;
        if (!mongodbUrl || !database || !collection) {
            return null;
        }

        return new MongoDBSnapshotStorage({
            mongodbUrl,
            database,
            collection,
        });
    }
}
