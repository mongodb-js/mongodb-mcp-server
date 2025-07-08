import { Collection, MongoClient } from "mongodb";
import { AccuracySnapshotEntry, AccuracySnapshotEntrySchema, AccuracySnapshotStorage } from "./snapshot-storage.js";

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
    ): Promise<void> {
        const snapshotWithMeta: AccuracySnapshotEntry = {
            ...snapshotEntry,
            commitSHA: this.commitSHA,
            accuracyRunId: this.accuracyRunId,
            createdOn: Date.now(),
        };
        await this.snapshotCollection.insertOne(snapshotWithMeta);
    }

    async getLastRunIdForCommit(commit: string): Promise<string | undefined> {
        const document = await this.snapshotCollection.findOne(
            { commit: commit },
            { sort: { createdOn: -1 }, projection: { accuracyRunId: 1 } }
        );

        return document?.accuracyRunId ? `${document?.accuracyRunId}` : undefined;
    }

    async getSnapshotEntriesForRunId(accuracyRunId: string): Promise<AccuracySnapshotEntry[]> {
        const snapshotEntries = await this.snapshotCollection.find({ accuracyRunId }).toArray();
        return AccuracySnapshotEntrySchema.array().parse(snapshotEntries);
    }

    static getStorage(commitSHA: string, accuracyRunId: string): MongoDBSnapshotStorage {
        const mongodbUrl = process.env.MDB_ACCURACY_MDB_URL;
        const database = process.env.MDB_ACCURACY_MDB_DB;
        const collection = process.env.MDB_ACCURACY_MDB_COLLECTION;
        if (!mongodbUrl || !database || !collection) {
            throw new Error("Cannot create MongoDBAccuracySnapshot storage without relevant configuration provided");
        }

        return new MongoDBSnapshotStorage({
            mongodbUrl,
            database,
            collection,
            commitSHA,
            accuracyRunId,
        });
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}
