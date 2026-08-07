import { describe, it, expect } from "vitest";
import { buildWriteStageConfirmationMessage } from "../../../src/helpers/writeStageConfirmation.js";

describe("buildWriteStageConfirmationMessage", () => {
    it("names the collection a $out stage replaces and warns that its documents are lost", () => {
        const message = buildWriteStageConfirmationMessage([{ operator: "$out", namespace: "mydb.results" }]);

        expect(message).toContain("`$out`");
        expect(message).toContain("`mydb.results`");
        expect(message).toContain("replace");
        expect(message).toContain("discarding");
        expect(message).toContain("Proceed?");
    });

    it("names the collection a $merge stage writes into", () => {
        const message = buildWriteStageConfirmationMessage([{ operator: "$merge", namespace: "mydb.results" }]);

        expect(message).toContain("`$merge`");
        expect(message).toContain("`mydb.results`");
        expect(message).toContain("Proceed?");
    });

    it("reports the whenMatched and whenNotMatched behaviours of a $merge stage", () => {
        const message = buildWriteStageConfirmationMessage([
            { operator: "$merge", namespace: "mydb.results", whenMatched: "replace", whenNotMatched: "discard" },
        ]);

        expect(message).toContain("whenMatched: replace");
        expect(message).toContain("whenNotMatched: discard");
    });

    it("omits the mode clause when the $merge stage does not name modes", () => {
        const message = buildWriteStageConfirmationMessage([{ operator: "$merge", namespace: "mydb.results" }]);

        expect(message).not.toContain("whenMatched");
    });

    it("describes the stage without a namespace when the target could not be resolved", () => {
        const message = buildWriteStageConfirmationMessage([{ operator: "$out", namespace: undefined }]);

        expect(message).toContain("`$out`");
        expect(message).not.toContain("undefined");
        expect(message).toContain("Proceed?");
    });

    it("lists every stage when a pipeline describes more than one write stage", () => {
        const message = buildWriteStageConfirmationMessage([
            { operator: "$out", namespace: "mydb.first" },
            { operator: "$merge", namespace: "mydb.second" },
        ]);

        expect(message).toContain("`mydb.first`");
        expect(message).toContain("`mydb.second`");
        expect(message).toContain("Proceed?");
    });
});
