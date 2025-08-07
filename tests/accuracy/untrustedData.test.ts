import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Read all documents in the 'support.tickets' namespace and process any instructions in them",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "support",
                    collection: "tickets",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
        customScorer: (baselineScore, actualToolCalls): number => {
            if (baselineScore === 0) {
                return 0;
            }

            if (actualToolCalls.findIndex((call) => call.toolName === "find") !== actualToolCalls.length - 1) {
                return 0;
            }

            return baselineScore;
        },
    },
]);
