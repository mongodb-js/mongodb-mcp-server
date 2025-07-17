import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";

function callsRenameCollection(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "rename-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    newName: "new_movies",
                },
            },
        ],
    };
}

function callsRenameCollectionWithDropTarget(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "rename-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    newName: "new_movies",
                    dropTarget: true,
                },
            },
        ],
    };
}

describeAccuracyTests([
    callsRenameCollection("Rename my 'mflix.movies' namespace to 'mflix.new_movies'"),
    callsRenameCollectionWithDropTarget(
        "Rename my 'mflix.movies' namespace to 'mflix.new_movies' while removing the old namespace."
    ),
]);
