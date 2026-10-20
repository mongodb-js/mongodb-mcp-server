import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunEvalInputSchema } from "./datasetTypes.js";

describe("RunEvalInputSchema", () => {
    it("preserves existing single-turn inputs without adding defaults", () => {
        const input = {
            prompt: "Count the movies.",
            db_seed: [
                "movies",
                {
                    synonyms: {
                        indexes: [{ type: "classic", name: "word", key: { word: 1 }, unique: true }],
                    },
                },
            ],
        };

        expect(RunEvalInputSchema.parse(input)).toEqual(input);
        expect(RunEvalInputSchema.parse({ prompt: "" })).toEqual({ prompt: "" });
    });

    it.each([
        { followUpPrompts: [] },
        { followUpPrompts: ["Use 1999."] },
        { followUpPrompts: Array.from({ length: 9 }, (_, index) => `Reply ${index + 1}`) },
    ])("accepts a bounded script: $followUpPrompts", ({ followUpPrompts }) => {
        const input = { prompt: "Which year?", follow_up_prompts: followUpPrompts };

        expect(RunEvalInputSchema.parse(input)).toEqual(input);
    });

    it("preserves scripted reply whitespace", () => {
        const input = { prompt: "Choose a query.", follow_up_prompts: ["  Use this query:\n    { year: 1999 }\n"] };

        expect(RunEvalInputSchema.parse(input)).toEqual(input);
    });

    it.each([
        { followUpPrompts: null },
        { followUpPrompts: "Use 1999." },
        { followUpPrompts: [""] },
        { followUpPrompts: [1999] },
        { followUpPrompts: Array.from({ length: 10 }, () => "Continue.") },
    ])("rejects invalid scripts: $followUpPrompts", ({ followUpPrompts }) => {
        expect(
            RunEvalInputSchema.safeParse({ prompt: "Which year?", follow_up_prompts: followUpPrompts }).success
        ).toBe(false);
    });

    it("includes optional scripted-turn bounds in the generated JSON schema", () => {
        const schema = z.toJSONSchema(RunEvalInputSchema);

        expect(schema.required).toEqual(["prompt"]);
        expect(schema.properties?.follow_up_prompts).toMatchObject({
            type: "array",
            maxItems: 9,
            items: { type: "string", minLength: 1 },
        });
    });
});
