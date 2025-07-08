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
    private readonly accuracyRunId: string;
    private readonly commitSHA: string;
    private constructor({
        mongodbUrl,
        database,
        collection,
        accuracyRunId,
        commitSHA,
    }: {
        mongodbUrl: string;
        database: string;
        collection: string;
        accuracyRunId: string;
        commitSHA: string;
    }) {
        this.client = new MongoClient(mongodbUrl);
        this.snapshotCollection = this.client.db(database).collection(collection);
        this.accuracyRunId = accuracyRunId;
        this.commitSHA = commitSHA;
    }

    async createSnapshotEntry(
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
    ): Promise<void> {
        const snapshotWithMeta: AccuracySnapshotEntry = {
            ...snapshotEntry,
            commitSHA: this.commitSHA,
            accuracyRunId: this.accuracyRunId,
            accuracyRunStatus: AccuracyRunStatus.InProgress,
            createdOn: Date.now(),
        };
        await this.snapshotCollection.insertOne(snapshotWithMeta);
    }

    async getLatestSnapshotsForCommit(commit: string): Promise<AccuracySnapshotEntry[]> {
        const latestRunId = await this.getLatestAccuracyRunForCommit(commit);
        return latestRunId ? this.getSnapshotEntriesForRunId(latestRunId) : [];
    }

    private async getLatestAccuracyRunForCommit(commit: string): Promise<string | undefined> {
        const document = await this.snapshotCollection.findOne(
            { commit: commit, accuracyRunStatus: AccuracyRunStatus.Done },
            { sort: { createdOn: -1 }, projection: { accuracyRunId: 1 } }
        );

        return document?.accuracyRunId ? `${document?.accuracyRunId}` : undefined;
    }

    private async getSnapshotEntriesForRunId(accuracyRunId: string): Promise<AccuracySnapshotEntry[]> {
        const snapshotEntries = await this.snapshotCollection.find({ accuracyRunId }).toArray();
        return AccuracySnapshotEntrySchema.array().parse(snapshotEntries);
    }

    async updateAccuracyRunStatus(status: AccuracyRunStatuses) {
        await this.snapshotCollection.updateMany(
            { accuracyRunId: this.accuracyRunId },
            { $set: { accuracyRunStatus: status } }
        );
    }

    async close(): Promise<void> {
        await this.client.close();
    }

    static getStorage(commitSHA: string, accuracyRunId: string): MongoDBSnapshotStorage | null {
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
            commitSHA,
            accuracyRunId,
        });
    }
}
