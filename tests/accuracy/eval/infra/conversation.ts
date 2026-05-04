import * as untracedAi from "ai";
import type { ModelMessage, OnStepFinishEvent } from "ai";
import { wrapAISDK } from "braintrust";

import type { VercelMCPClientTools } from "../../sdk/agent.js";
import type { Model } from "../../sdk/models.js";

const ai = wrapAISDK(untracedAi); // wraps Vercel AI SDK for Braintrust tracing

// Number of LLM steps (tool calls, tool results, and assistant messages) allowed
// per conversation before forcefully stopping it to prevent infinite loops in failure cases.
const DEFAULT_STEP_COUNT = 10;

// Truncate tool outputs in the conversation serialization (used to feed the conversation
// into the judge bot and follow-up bot) to prevent overwhelming their context windows
// with verbose tool results.
const CONVERSATION_SERIALIZER_MAX_TOOL_OUTPUT_CHARS = 4000;

export const ROLE = {
    USER: "USER",
    ASSISTANT: "ASSISTANT",
    FOLLOW_UP_BOT: "FOLLOW-UP-BOT",
    JUDGE_BOT: "JUDGE-BOT",
} as const;

export class Conversation {
    private messages: ModelMessage[] = [];
    readonly tools: VercelMCPClientTools;
    readonly model: Model;

    constructor(tools: VercelMCPClientTools, model: Model, initialMessages: ModelMessage[] = []) {
        this.tools = tools;
        this.model = model;
        this.messages = [...initialMessages];
    }

    async converse(systemPrompt: string, userPrompt: string): Promise<void> {
        debugStep(ROLE.USER, { stepNumber: 0, text: userPrompt } as OnStepFinishEvent<any>);
        this.appendMessages({ role: "user" as const, content: userPrompt });

        const result = await ai.generateText({
            model: this.model.getModel(),
            system: systemPrompt,
            messages: this.getMessages(),
            tools: this.tools,
            onStepFinish: (step) => debugStep(ROLE.ASSISTANT, step),
            stopWhen: ai.stepCountIs(DEFAULT_STEP_COUNT),
        });

        this.appendMessages(...result.response.messages);
    }

    getMessages(): ModelMessage[] {
        return this.messages;
    }

    private appendMessages(...messages: ModelMessage[]): void {
        this.messages.push(...messages);
    }
}

// Produces numbered <turn> XML blocks consumed by the follow-up bot and judge bot as their conversation input.
export function serializeMessages(messages: ModelMessage[]): string {
    const truncate = (s: string, max: number) =>
        s.length <= max ? s : `${s.slice(0, max)}…[truncated ${s.length - max} chars]`;
    const blocks: string[] = [];
    let turn = 0;
    for (const msg of messages) {
        const role = String((msg.role as string | undefined) ?? "unknown");
        const content = (msg as Record<string, unknown>).content;
        const inner: string[] = [];
        if (typeof content === "string") {
            if (content) inner.push(content);
        } else if (Array.isArray(content)) {
            for (const part of content as Record<string, unknown>[]) {
                switch (part.type) {
                    case "text":
                        if (part.text) inner.push(String(part.text as string));
                        break;
                    case "tool-call": {
                        const id = String(part.toolCallId ?? "");
                        const name = String(part.toolName ?? "");
                        inner.push(`<tool_call id="${id}" name="${name}">${JSON.stringify(part.input)}</tool_call>`);
                        break;
                    }
                    case "tool-result": {
                        const id = String(part.toolCallId ?? "");
                        const name = String(part.toolName ?? "");
                        const output = truncate(
                            JSON.stringify(part.output),
                            CONVERSATION_SERIALIZER_MAX_TOOL_OUTPUT_CHARS
                        );
                        inner.push(`<tool_result for="${id}" name="${name}">${output}</tool_result>`);
                        break;
                    }
                    default:
                        inner.push(JSON.stringify(part));
                }
            }
        }
        if (inner.length === 0) continue;
        turn += 1;
        blocks.push(`<turn n="${turn}" role="${role}">\n${inner.join("\n")}\n</turn>`);
    }
    return blocks.join("\n");
}

// Prints conversation progress in a human-friendly format with color-coding for easier debugging of eval failures.
export function debugStep(role: string, step: OnStepFinishEvent<any>): void {
    if (!process.env.DEBUG) return;

    const colors = {
        cyan: "\x1b[36m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        magenta: "\x1b[35m",
        red: "\x1b[31m",
        blue: "\x1b[34m",
        reset: "\x1b[0m",
    };
    if (step.reasoningText) {
        console.log(`${colors.cyan}${role} (#${step.stepNumber}): REASONING: ${step.reasoningText}${colors.reset}`);
    }
    if (step.text) {
        let color = colors.yellow;
        if (role === `${ROLE.ASSISTANT}[${ROLE.FOLLOW_UP_BOT}]`) {
            color = colors.red;
        } else if (role === `${ROLE.ASSISTANT}[${ROLE.JUDGE_BOT}]`) {
            color = colors.magenta;
        } else if (role === ROLE.ASSISTANT) {
            color = colors.green;
        }
        console.log(`${color}${role} (#${step.stepNumber}): ${step.text}${colors.reset}`);
    }
    if (step.toolResults && step.toolResults.length > 0) {
        const first = step.toolResults[0]!;
        if (
            step.toolResults.length === 1 &&
            (first.toolName === "submit-score" || first.toolName === "submit-follow-up")
        ) {
            console.log(`${colors.green}${role} (#${step.stepNumber}): VERDICT: ${JSON.stringify(first.input, null, 2)}${colors.reset}`);
        } else {
            console.log(`${colors.blue}${role} (#${step.stepNumber}): TOOL-CALL: ${JSON.stringify(step.toolResults, null, 2)}${colors.reset}`);
        }
    } else if (step.toolCalls && step.toolCalls.length > 0) {
        console.log(`${colors.yellow}${role} (#${step.stepNumber}): TOOL-REQUEST: ${JSON.stringify(step.toolCalls, null, 2)}${colors.reset}`);
    }
}
