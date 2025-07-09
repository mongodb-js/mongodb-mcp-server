import { getAccuracySnapshotStorage } from "../tests/accuracy/sdk/accuracy-snapshot-storage/get-snapshot-storage.js";
import {
    AccuracyRunStatus,
    AccuracyRunStatuses,
} from "../tests/accuracy/sdk/accuracy-snapshot-storage/snapshot-storage.js";

const envAccuracyRunId = process.env.MDB_ACCURACY_RUN_ID;
const envAccuracyRunStatus = process.env.MDB_ACCURACY_RUN_STATUS;

let status: AccuracyRunStatuses | undefined;
if (
    !envAccuracyRunId ||
    (envAccuracyRunStatus !== AccuracyRunStatus.Done && envAccuracyRunStatus !== AccuracyRunStatus.Failed)
) {
    process.exit(1);
}

console.time(`Marked accuracy run id - ${envAccuracyRunId} as ${status} in`);
const storage = await getAccuracySnapshotStorage();
await storage.updateAccuracyRunStatus(envAccuracyRunId, envAccuracyRunStatus);
await storage.close();
console.timeEnd(`Marked accuracy run id - ${envAccuracyRunId} as ${status} in`);
