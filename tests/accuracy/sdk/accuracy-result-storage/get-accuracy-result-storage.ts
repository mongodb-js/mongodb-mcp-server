import { DiskBasedResultStorage } from "./disk-storage.js";
import { MongoDBBasedResultStorage } from "./mongodb-storage.js";
import { AccuracyResultStorage } from "./result-storage.js";

export function getAccuracyResultStorage(): AccuracyResultStorage {
    if (process.env.MDB_ACCURACY_MDB_URL) {
        return new MongoDBBasedResultStorage(process.env.MDB_ACCURACY_MDB_URL);
    }
    return new DiskBasedResultStorage();
}
