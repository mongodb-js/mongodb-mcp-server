import { DiskSnapshotStorage } from "./disk-snapshot-storage.js";
import { MongoDBSnapshotStorage } from "./mdb-snapshot-storage.js";
import { AccuracySnapshotStorage } from "./snapshot-storage.js";

export async function getAccuracySnapshotStorage(): Promise<AccuracySnapshotStorage> {
    return MongoDBSnapshotStorage.getStorage() ?? (await DiskSnapshotStorage.getStorage());
}
