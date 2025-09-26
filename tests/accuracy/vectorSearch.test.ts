import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

// Accuracy tests for the new vector-search tool. These prompts are phrased in a way
// that the planner should infer the appropriate tool and arguments. We only
// check argument structure, not exact numeric array contents beyond basic shape.

describeAccuracyTests([
    {
        prompt: "Use the embeddings in 'ai.docs' to find the 5 most similar documents to the given vector [0.1, 0.2, 0.3].",
        expectedToolCalls: [
            {
                toolName: "vector-search",
                parameters: {
                    database: "ai",
                    collection: "docs",
                    queryVector: [0.1, 0.2, 0.3],
                    path: Matcher.anyOf(Matcher.value("embedding"), Matcher.string()),
                    limit: 5,
                    // numCandidates may be defaulted; allow undefined or positive number
                    numCandidates: Matcher.anyOf(Matcher.undefined, Matcher.number((v) => v > 0)),
                },
            },
        ],
    },
    {
        prompt: "In database 'ai', collection 'docs', perform a vector similarity search over field 'embedding' for vector [0.25,0.11,0.89,0.4] and return top 3 results including the raw embedding.",
        expectedToolCalls: [
            {
                toolName: "vector-search",
                parameters: {
                    database: "ai",
                    collection: "docs",
                    queryVector: [0.25, 0.11, 0.89, 0.4],
                    path: "embedding",
                    limit: 3,
                    includeVector: true,
                    numCandidates: Matcher.anyOf(Matcher.undefined, Matcher.number((v) => v > 0)),
                },
            },
        ],
    },
]);
