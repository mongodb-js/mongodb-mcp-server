import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsFindNoFilter(prompt: string, database = "mflix", collection = "movies"): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database,
                    collection,
                },
            },
        ],
    };
}

function callsFindWithFilter(prompt: string, filter: Record<string, unknown>): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: filter,
                },
            },
        ],
    };
}

function callsFindWithProjection(prompt: string, projection: Record<string, number>): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    projection,
                },
            },
        ],
    };
}

function callsFindWithProjectionAndFilters(
    prompt: string,
    filter: Record<string, unknown>,
    projection: Record<string, number>
): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter,
                    projection,
                },
            },
        ],
    };
}

function callsFindWithFilterSortAndLimit(
    prompt: string,
    filter: Record<string, unknown>,
    sort: Record<string, number>,
    limit: number
): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter,
                    sort,
                    limit,
                },
            },
        ],
    };
}

describeAccuracyTests([
    callsFindNoFilter("List all the movies in 'mflix.movies' namespace."),
    callsFindNoFilter("List all the documents in 'comics.books' namespace.", "comics", "books"),
    callsFindWithFilter("Find all the movies in 'mflix.movies' namespace with runtime less than 100.", {
        runtime: { $lt: 100 },
    }),
    callsFindWithFilter("Find all movies in 'mflix.movies' collection where director is 'Christina Collins'", {
        director: "Christina Collins",
    }),
    callsFindWithProjection("Give me all the movie titles available in 'mflix.movies' namespace", { title: 1 }),
    callsFindWithProjectionAndFilters(
        "Use 'mflix.movies' namespace to answer who were casted in the movie 'Certain Fish'",
        { title: "Certain Fish" },
        { cast: 1 }
    ),
    callsFindWithFilterSortAndLimit(
        "From the mflix.movies namespace, give me first 2 movies of Horror genre sorted ascending by their runtime",
        { genres: "Horror" },
        { runtime: 1 },
        2
    ),
]);
