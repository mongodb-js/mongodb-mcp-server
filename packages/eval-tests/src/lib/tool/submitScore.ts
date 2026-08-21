import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Verdict } from "../datasetTypes.js";

/**
 * Synthetic judge tool that captures the verdict on submit.
 * Use getCapturedVerdict() to retrieve the captured verdict after submission.
 */
export class SubmitScoreTool {
    #captured: Verdict | undefined;
    public static readonly toolName: string = "submit_score";

    private static readonly scoreSchema = z.object({
        score: z.number().min(0).max(1).describe("0.0 = criteria not satisfied at all, 1.0 = fully satisfied"),
        explanation: z.string().describe("brief explanation of the score"),
    });

    getTool(): Tool {
        return tool({
            description: "Submit your final score. Call this exactly once when ready.",
            inputSchema: SubmitScoreTool.scoreSchema,
            execute: (input) => {
                if (this.#captured !== undefined) {
                    throw new Error(`${SubmitScoreTool.toolName} must be called exactly once`);
                }
                this.#captured = input;
                return { ok: true };
            },
        });
    }

    /**
     * Get the captured verdict.
     * @returns The captured verdict.
     */
    getCapturedVerdict(): Verdict | undefined {
        return this.#captured;
    }
}
