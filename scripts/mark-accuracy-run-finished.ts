import { getAccuracySnapshotStorage } from "../tests/accuracy/sdk/accuracy-snapshot-storage/get-snapshot-storage.js";
import {
    AccuracyRunStatus,
    AccuracyRunStatuses,
} from "../tests/accuracy/sdk/accuracy-snapshot-storage/snapshot-storage.js";

let status: AccuracyRunStatuses | undefined;
if (process.env.MDB_ACCURACY_RUN_STATUS === "done") {
    status = AccuracyRunStatus.Done;
} else if (process.env.MDB_ACCURACY_RUN_STATUS === "failed") {
    status = AccuracyRunStatus.Failed;
} else {
    console.info(`Unknown status - ${process.env.MDB_ACCURACY_RUN_STATUS}, will not update accuracy run.`);
    process.exit(1);
}

console.time(`Marked accuracy run id - ${process.env.MDB_ACCURACY_RUN_ID} as ${status} in`);
const storage = await getAccuracySnapshotStorage();
await storage.updateAccuracyRunStatus(status);
await storage.close();
console.timeEnd(`Marked accuracy run id - ${process.env.MDB_ACCURACY_RUN_ID} as ${status} in`);
