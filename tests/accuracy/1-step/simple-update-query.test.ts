import { describeAccuracyTest } from "../test-sdk.js";

describeAccuracyTest("1 step update queries", ({ prompt }) => {
    prompt("set all users with an empty email to disabled in database 'my' and collection 'users'", (tool) => {
        tool("update-many").verifyCalled({
            database: "my",
            collection: "users",
            filter: { email: "" },
            update: { $set: { disabled: true } },
        });
    });
});
