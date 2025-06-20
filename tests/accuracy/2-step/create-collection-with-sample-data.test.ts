import { describeAccuracyTest } from "../test-sdk.js";

describeAccuracyTest("2 step create collection", ({ prompt }) => {
    prompt(
        `
        create a new collection named 'users' in database 'my' and afterwards create a sample document with the following data:
        - username: "john_doe"
        - email: test@mongodb.com
        - password: "password123"
        - disabled: false
    `,
        (tool) => {
            tool("create-collection").verifyCalled({
                database: "my",
                collection: "users",
            });

            tool("insert-many").verifyCalled({
                database: "my",
                collection: "users",
                documents: [
                    {
                        username: "john_doe",
                        email: "test@mongodb.com",
                        password: "password123",
                        disabled: false,
                    },
                ],
            });
        }
    );
});
