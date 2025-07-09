import { getCommitSHA } from "../git-info.js";
import { DiskSnapshotStorage } from "./disk-snapshot-storage.js";
import { MongoDBSnapshotStorage } from "./mdb-snapshot-storage.js";
import { AccuracySnapshotStorage } from "./snapshot-storage.js";

export async function getAccuracySnapshotStorage(): Promise<AccuracySnapshotStorage> {
    const accuracyRunId = process.env.MDB_ACCURACY_RUN_ID;
    if (!accuracyRunId) {
        throw new Error(
            "Cannot create AccuracySnapshotStorage without an accuracyRunId - ensure that the relevant env variable is present."
        );
    }

    const commitSHA = await getCommitSHA();
    if (!commitSHA) {
        throw new Error("Cannot create AccuracySnapshotStorage without a commitSHA.");
    }

    return MongoDBSnapshotStorage.getStorage() ?? (await DiskSnapshotStorage.getStorage());
}
