import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import {
    AccuracyRunStatus,
    AccuracySnapshotEntry,
    AccuracySnapshotEntrySchema,
    AccuracySnapshotStorage,
} from "./snapshot-storage.js";
const __dirname = fileURLToPath(import.meta.url);
const rootDir = path.resolve(__dirname, "..", "..", "..", "..", "..");
const snapshotsDir = path.resolve(rootDir, ".accuracy-snapshots");
export const snapshotFilePath = path.resolve(snapshotsDir, "snapshots.json");

export class DiskSnapshotStorage implements AccuracySnapshotStorage {
    private constructor(
        private readonly accuracyRunId: string,
        private readonly commitSHA: string
    ) {}

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

        await this.appendAccuracySnapshot(snapshotWithMeta);
    }

    async getLatestSnapshotsForCommit(commit: string): Promise<AccuracySnapshotEntry[]> {
        const snapshot = await this.readSnapshot();
        const entries = snapshot
            .filter((entry) => {
                return entry.commitSHA === commit && entry.accuracyRunStatus === AccuracyRunStatus.Done;
            })
            .sort((a, b) => b.createdOn - a.createdOn);
        const latestRunId = entries[0]?.accuracyRunId;
        return latestRunId ? snapshot.filter((entry) => entry.accuracyRunId === latestRunId) : [];
    }

    async accuracyRunFinished(): Promise<void> {
        const snapshot = await this.readSnapshot();
        const updatedSnapshot = snapshot.map((entry) => {
            if (entry.accuracyRunId === this.accuracyRunId) {
                return {
                    ...entry,
                    accuracyRunStatus: AccuracyRunStatus.Done,
                };
            }

            return entry;
        });
        await this.writeSnapshot(updatedSnapshot);
    }

    close(): Promise<void> {
        return Promise.resolve();
    }

    private async appendAccuracySnapshot(entry: AccuracySnapshotEntry): Promise<void> {
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const snapshot = await this.readSnapshot();
                snapshot.unshift(entry);
                await this.writeSnapshot(snapshot);
                return;
            } catch (e) {
                if (attempt < 4) {
                    await this.waitFor(100 + Math.random() * 200);
                } else {
                    throw e;
                }
            }
        }
    }

    private async writeSnapshot(snapshot: AccuracySnapshotEntry[]): Promise<void> {
        const tmp = `${snapshotFilePath}~${Date.now()}`;
        await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2));
        await fs.rename(tmp, snapshotFilePath);
    }

    private async readSnapshot(): Promise<AccuracySnapshotEntry[]> {
        try {
            const raw = await fs.readFile(snapshotFilePath, "utf8");
            return AccuracySnapshotEntrySchema.array().parse(JSON.parse(raw));
        } catch (e: unknown) {
            if ((e as { code: string }).code === "ENOENT") {
                return [];
            }
            throw e;
        }
    }

    private waitFor(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    static async getStorage(commitSHA: string, accuracyRunId: string) {
        await fs.mkdir(snapshotsDir, { recursive: true });
        return new DiskSnapshotStorage(commitSHA, accuracyRunId);
    }
}
