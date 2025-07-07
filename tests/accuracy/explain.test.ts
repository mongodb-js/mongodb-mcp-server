import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsExplain(prompt: string, method: Record<string, unknown>): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
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
describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should call 'explain' tool for a find query", [
        callsExplainWithFind(
            `Will fetching documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
        ),
    ]),
    ...describeSuite("should call 'explain' tool for an aggregation", [
        callsExplainWithAggregate(
            `Will aggregating documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
        ),
    ]),
    ...describeSuite("should call 'explain' tool for count", [
        callsExplainWithCount(
            `Will counting documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`
        ),
    ]),
});
