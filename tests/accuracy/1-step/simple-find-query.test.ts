import { describeAccuracyTest } from "../test-sdk.js";

describeAccuracyTest("1 step find queries", ({ prompt }) => {
    prompt("find all users in database 'my' and collection 'users'", (tool) => {
        tool("find").verifyCalled({ database: "my", collection: "users", limit: 10 });
    });

    prompt("find all red cars in database 'production' and collection 'cars'", (tool) => {
        tool("find").verifyCalled({ filter: { color: "red" }, database: "production", collection: "cars", limit: 10 });
    });

    prompt("get 100 books in database 'prod' and collection 'books' where the author is J.R.R Tolkien", (tool) => {
        tool("find").verifyCalled({
            filter: { author: "J.R.R Tolkien" },
            database: "prod",
            collection: "books",
            limit: 100,
        });
    });
});
