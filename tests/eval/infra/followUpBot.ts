import * as untracedAi from "ai";
import { wrapAISDK, traced } from "braintrust";
import { z } from "zod";

import type { Model } from "../../accuracy/sdk/models.js";
import type { FollowUpResult } from "./scaffolding.types.js";
import { type Conversation, ROLE, serializeMessages, debugStep } from "./conversation.js";

const ai = wrapAISDK(untracedAi);

const followUpSchema = z.object({
    hasFollowUp: z
        .boolean()
        .describe("true if a follow-up instruction is still applicable and would advance the conversation, false if none are"),
    explanation: z.string().describe("brief explanation of the decision"),
    response: z.string().optional().describe("message to send as the user (required when hasFollowUp=true)"),
});

export class FollowUpBot {
    constructor(private model: Model) { }

    async decide(conversation: Conversation, instructions: string | string[]): Promise<FollowUpResult> {
        const instructionsArray = Array.isArray(instructions) ? instructions : [instructions];
        const conversationSummary = serializeMessages(conversation.getMessages());

        // We capture structured data via tool calls rather than forcing schema on text generation,
        // which preserves the model's reasoning for debugging.
        let followUpResult: z.infer<typeof followUpSchema> = {
            hasFollowUp: false,
            explanation: "No follow-up needed by default",
        };
        const submitFollowUpTool = untracedAi.tool({
            description: "Submit your follow-up decision. Call this exactly once.",
            inputSchema: followUpSchema,
            execute: async (input) => {
                followUpResult = input;
                return { ok: true };
            },
        });

        await traced(
            async () => {
                const userPrompt = `Process this conversation:\n${conversationSummary}`;
                debugStep(`${ROLE.USER}[${ROLE.FOLLOW_UP_BOT}]`, { stepNumber: 0, text: userPrompt } as any);

                await ai.generateText({
                    model: this.model.getModel(),
                    system: buildFollowUpSystemPrompt(instructionsArray),
                    messages: [{ role: "user" as const, content: userPrompt }],
                    tools: { "submit-follow-up": submitFollowUpTool },
                    onStepFinish: (step) => debugStep(`${ROLE.ASSISTANT}[${ROLE.FOLLOW_UP_BOT}]`, step),
                    stopWhen: [ai.hasToolCall("submit-follow-up")],
                });
            },
            { name: "follow-up-bot" }
        );

        if (followUpResult.hasFollowUp) {
            return {
                hasFollowUp: true,
                response: followUpResult.response!
            };
        } else {
            return {
                hasFollowUp: false,
            }
        }
    }
}

function buildFollowUpSystemPrompt(instructions: string[]): string {
    return [
        "You are a human tester working with a MongoDB AI assistant.",
        "You receive a conversation transcript (including tool calls and results) and follow-up instructions.",
        "",
        "### Follow-up instructions",
        ...instructions.map((s, i) => `${i + 1}. ${s}`),
        "",
        "### Behaviour",
        "- Review the conversation and determine if any follow-up instruction is still applicable and would advance the conversation.",
        "- If yes: call `submit-follow-up` with hasFollowUp=true and a `response` written as a user directive in first person as concise as possible.",
        "- If no applicable instructions remain: call `submit-follow-up` with hasFollowUp=false.",
    ].join("\n");
}
