import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsExplain(prompt: string, method: Record<string, unknown>): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    method: [method],
                },
            },
        ],
    };
}

const callsExplainWithFind = (prompt: string) =>
    callsExplain(prompt, {
        name: "find",
        arguments: {
            filter: { release_year: 2020 },
        },
    });

const callsExplainWithAggregate = (prompt: string) =>
    callsExplain(prompt, {
        name: "aggregate",
        arguments: {
            pipeline: [
                {
                    $match: { release_year: 2020 },
                },
            ],
        },
    });

const callsExplainWithCount = (prompt: string) =>
    callsExplain(prompt, {
        name: "count",
        arguments: {
            query: { release_year: 2020 },
        },
    });

/**
 * None of these tests score a parameter match on any of the models, likely
 * because we are using Zod.union, when we probably should've used
 * Zod.discriminatedUnion
 */
describeAccuracyTests([
    callsExplainWithFind(
        `Will fetching documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
    ),
    callsExplainWithAggregate(
        `Will aggregating documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
    ),
    callsExplainWithCount(
        `Will counting documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
    ),
]);
