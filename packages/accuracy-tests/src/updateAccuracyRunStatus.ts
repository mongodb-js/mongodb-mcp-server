import { getAccuracyResultStorage } from "./sdk/accuracyResultStorage/getAccuracyResultStorage.js";
import { AccuracyRunStatus } from "./sdk/accuracyResultStorage/resultStorage.js";
import { getCommitSHA } from "./sdk/gitInfo.js";

const envAccuracyRunId = process.env.MDB_ACCURACY_RUN_ID;
const envAccuracyRunStatus = process.env.MDB_ACCURACY_RUN_STATUS;
const commitSHA = await getCommitSHA();

if (
    !envAccuracyRunId ||
    !commitSHA ||
    (envAccuracyRunStatus !== AccuracyRunStatus.Done && envAccuracyRunStatus !== AccuracyRunStatus.Failed)
) {
    process.exit(1);
}

console.time(`Marked accuracy run id - ${envAccuracyRunId} as ${envAccuracyRunStatus} in`);
const storage = getAccuracyResultStorage();
await storage.updateRunStatus(commitSHA, envAccuracyRunId, envAccuracyRunStatus);
await storage.close();
console.timeEnd(`Marked accuracy run id - ${envAccuracyRunId} as ${envAccuracyRunStatus} in`);
