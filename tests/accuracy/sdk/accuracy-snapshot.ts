import fs from "fs/promises";
import path from "path";
import { z } from "zod";

export const SNAPSHOT_FILE_PATH = path.resolve(process.cwd(), "accuracy-snapshot.json");

export const AccuracySnapshotEntrySchema = z.object({
    datetime: z.string(),
    commit: z.string(),
    model: z.string(),
    suite: z.string(),
    test: z.string(),
    toolCallingAccuracy: z.number(),
    parameterAccuracy: z.number(),
});

export type AccuracySnapshotEntry = z.infer<typeof AccuracySnapshotEntrySchema>;

export async function readSnapshot(): Promise<AccuracySnapshotEntry[]> {
    try {
        const raw = await fs.readFile(SNAPSHOT_FILE_PATH, "utf8");
        return AccuracySnapshotEntrySchema.array().parse(JSON.parse(raw));
    } catch (e: unknown) {
        if ((e as { code: string }).code === "ENOENT") {
            return [];
        }
        throw e;
    }
}

function waitFor(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function appendAccuracySnapshot(entry: AccuracySnapshotEntry): Promise<void> {
    AccuracySnapshotEntrySchema.parse(entry);

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const snapshot = await readSnapshot();
            snapshot.unshift(entry);
            const tmp = `${SNAPSHOT_FILE_PATH}~${Date.now()}`;
            await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2));
            await fs.rename(tmp, SNAPSHOT_FILE_PATH);
            return;
        } catch (e) {
            if (attempt < 4) {
                await waitFor(100 + Math.random() * 200);
            } else {
                throw e;
            }
        }
    }
}
