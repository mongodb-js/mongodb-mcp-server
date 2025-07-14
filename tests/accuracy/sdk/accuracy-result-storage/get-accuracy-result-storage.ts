import { DiskBasedResultStorage } from "./disk-storage.js";
import { MongoDBBasedResultStorage } from "./mongodb-storage.js";
import { AccuracyResultStorage } from "./result-storage.js";

export function getAccuracyResultStorage(): AccuracyResultStorage {
    const { MDB_ACCURACY_MDB_URL, MDB_ACCURACY_MDB_DB, MDB_ACCURACY_MDB_COLLECTION } = process.env;
    if (MDB_ACCURACY_MDB_URL && MDB_ACCURACY_MDB_DB && MDB_ACCURACY_MDB_COLLECTION) {
        return new MongoDBBasedResultStorage(MDB_ACCURACY_MDB_URL, MDB_ACCURACY_MDB_DB, MDB_ACCURACY_MDB_COLLECTION);
    }
    return new DiskBasedResultStorage();
}
