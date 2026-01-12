import type { ExpectedToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const optionalListCalls: (database: string) => ExpectedToolCall[] = (database) => [
    {
        toolName: "list-databases",
        parameters: {},
        optional: true,
    },
    {
        toolName: "list-collections",
        parameters: {
            database,
        },
        optional: true,
    },
];

describeAccuracyTests([
    {
        prompt: "List all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.emptyObjectOrUndefined,
                    limit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                },
            },
        ],
    },
    {
        prompt: "Find all the documents in 'comics.books' namespace.",
        expectedToolCalls: [
            ...optionalListCalls("comics"),
            {
                toolName: "find",
                parameters: {
                    database: "comics",
                    collection: "books",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "Find all the movies in 'mflix.movies' namespace with runtime less than 100.",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: {
                        runtime: { $lt: 100 },
                    },
                },
            },
        ],
    },
    {
        prompt: "Find all movies in 'mflix.movies' collection where director is 'Christina Collins'",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: {
                        director: "Christina Collins",
                    },
                },
            },
        ],
    },
    {
        prompt: "Give me all the movie titles available in 'mflix.movies' namespace",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    projection: {
                        title: 1,
                        _id: Matcher.anyOf(
                            Matcher.undefined,
                            Matcher.number((value) => value === 0)
                        ),
                    },
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "Use 'mflix.movies' namespace to answer who were casted in the movie 'Certain Fish'",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { title: "Certain Fish" },
                    projection: {
                        cast: 1,
                        _id: Matcher.anyValue,
                    },
                    limit: Matcher.anyValue,
                },
            },
        ],
    },
    {
        prompt: "From the mflix.movies namespace, give me first 2 movies of Horror genre sorted ascending by their runtime",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { genres: Matcher.anyOf(Matcher.value("Horror"), Matcher.value({ $in: ["Horror"] })) },
                    projection: Matcher.anyValue,
                    sort: { runtime: 1 },
                    limit: 2,
                },
            },
        ],
    },
    {
        prompt: "I want an exported COMPLETE list of all the movies ONLY from 'mflix.movies' namespace.",
        expectedToolCalls: [
            ...optionalListCalls("mflix"),
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.anyValue,
                    projection: Matcher.anyValue,
                    limit: Matcher.anyValue,
                    sort: Matcher.anyValue,
                },
                optional: true,
            },
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    exportTitle: Matcher.string(),
                    exportTarget: [
                        {
                            name: "find",
                            arguments: Matcher.anyOf(
                                Matcher.emptyObjectOrUndefined,
                                Matcher.value({
                                    filter: Matcher.emptyObjectOrUndefined,
                                    projection: Matcher.anyValue,
                                    limit: Matcher.anyValue,
                                    sort: Matcher.anyValue,
                                })
                            ),
                        },
                    ],
                    jsonExportFormat: Matcher.anyOf(
                        Matcher.undefined,
                        Matcher.value("relaxed"),
                        Matcher.value("canonical")
                    ),
                },
            },
        ],
    },
]);
