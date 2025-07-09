import fs from "fs/promises";
import {
    AccuracyRunStatus,
    AccuracyRunStatuses,
    AccuracySnapshotEntry,
    AccuracySnapshotEntrySchema,
    AccuracySnapshotStorage,
} from "./snapshot-storage.js";
import { GENERATED_ASSETS_DIR, LOCAL_SNAPSHOTS_FILE } from "../constants.js";

export class DiskSnapshotStorage implements AccuracySnapshotStorage {
    async createSnapshotEntry(
        snapshotEntry: Pick<
            AccuracySnapshotEntry,
            | "accuracyRunId"
            | "commitSHA"
            | "provider"
            | "requestedModel"
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

        await this.appendAccuracySnapshot(snapshotWithMeta);
    }

    async getLatestSnapshotForCommit(commit: string): Promise<AccuracySnapshotEntry[]> {
        const snapshot = await this.readSnapshot();
        const entries = snapshot
            .filter((entry) => {
                return entry.commitSHA === commit && entry.accuracyRunStatus === AccuracyRunStatus.Done;
            })
            .sort((a, b) => b.createdOn - a.createdOn);
        const latestRunId = entries[0]?.accuracyRunId;
        return latestRunId ? snapshot.filter((entry) => entry.accuracyRunId === latestRunId) : [];
    }

    async getSnapshotForAccuracyRun(accuracyRunId: string): Promise<AccuracySnapshotEntry[]> {
        const snapshot = await this.readSnapshot();
        return snapshot.filter((entry) => entry.accuracyRunId === accuracyRunId);
    }

    async updateAccuracyRunStatus(accuracyRunId: string, status: AccuracyRunStatuses) {
        const snapshot = await this.readSnapshot();
        const updatedSnapshot = snapshot.map((entry) => {
            if (entry.accuracyRunId === accuracyRunId) {
                return {
                    ...entry,
                    accuracyRunStatus: status,
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
        const tmp = `${LOCAL_SNAPSHOTS_FILE}~${Date.now()}`;
        await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2));
        await fs.rename(tmp, LOCAL_SNAPSHOTS_FILE);
    }

    private async readSnapshot(): Promise<AccuracySnapshotEntry[]> {
        try {
            const raw = await fs.readFile(LOCAL_SNAPSHOTS_FILE, "utf8");
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

    static async getStorage() {
        await fs.mkdir(GENERATED_ASSETS_DIR, { recursive: true });
        return new DiskSnapshotStorage();
    }
}
