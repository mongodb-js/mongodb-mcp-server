import { getAccuracySnapshotStorage } from "../tests/accuracy/sdk/accuracy-snapshot-storage/get-snapshot-storage.js";

console.time(`Marked accuracy run id - ${process.env.MDB_ACCURACY_RUN_ID} as finished in`);
const storage = await getAccuracySnapshotStorage();
await storage.accuracyRunFinished();
await storage.close();
console.timeEnd(`Marked accuracy run id - ${process.env.MDB_ACCURACY_RUN_ID} as finished in`);
