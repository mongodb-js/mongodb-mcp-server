import { tool, type Tool } from "ai";
import { z } from "zod";

/**
 * Synthetic judge tool exposing the eval case's reference answer.
 * Returned to the judge when a criterion references `$reference_answer`.
 *
 * Accepts a raw reference answer string; provides it for judge inspection.
 */
export class GetReferenceAnswerTool {
    public static readonly toolName: string = "get_reference_answer";
    public static readonly keyword: string = "$reference_answer";
    #referenceAnswer: string;

    /**
     * @param referenceAnswer - The reference answer for the eval case.
     */
    constructor(referenceAnswer: string) {
        this.#referenceAnswer = referenceAnswer;
    }

    /**
     * @returns The synthetic judge tool exposing the reference answer.
     */
    getTool(): Tool {
        return tool({
            description: `Returns the reference_answer for the eval case.
            Call this when the criteria references ${GetReferenceAnswerTool.keyword}.`,
            inputSchema: z.object({}),
            execute: () => ({ referenceAnswer: this.#referenceAnswer }),
        });
    }
}
