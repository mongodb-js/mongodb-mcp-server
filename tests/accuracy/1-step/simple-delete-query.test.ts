import { describeAccuracyTest } from "../test-sdk.js";

describeAccuracyTest("1 step delete queries", ({ prompt }) => {
    prompt("delete all disabled users (disabled = true) in database 'my' and collection 'users'", (tool) => {
        tool("delete-many").verifyCalled({
            database: "my",
            collection: "users",
            filter: { disabled: true },
        });
    });
});
