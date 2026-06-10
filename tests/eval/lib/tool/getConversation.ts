import { tool, type Tool, type ModelMessage } from "ai";
import { z } from "zod";

/**
 * Truncate a string to a maximum length if it exceeds the maximum length and append a suffix indicating the number of characters truncated.
 *
 * Example:
 * ```
 * truncate("Hello, world!", 10) // "Hello, world!"
 * truncate("Hello, world!", 2) // "He…[truncated 8 chars]"
 * ```
 *
 * @param value - The value to truncate.
 * @param max - The maximum length of the value.
 * @returns The truncated value.
 */
function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/**
 * Pass through the value if it is already a string, otherwise returns an empty string.
 *
 * @param value - The value to pass through.
 * @returns The value if it is a string, otherwise an empty string.
 */
function partString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

const MAX_TOOL_OUTPUT_CHARS = 4000;

/**
 * Produces numbered `<turn>` blocks to be consumed by the judge
 * via get_conversation tool to verify the criteria against the conversation.
 *
 * Example:
 * ```
 * <turn n="1" role="user">
 *   What is the capital of France?
 * </turn>
 * <turn n="1" role="assistant">
 *   <tool_call id="1" name="get_capital">
 *     France
 *   </tool_call>
 * </turn>
 * <turn n="2" role="assistant">
 *   The capital of France is Paris.
 * </turn>
 * ```
 *
 * @param messages - The messages to serialize.
 * @returns The serialized messages in a LLM friendly format.
 */
function serializeMessages(messages: ModelMessage[]): string {
    const blocks: string[] = [];
    let turn = 0;

    for (const msg of messages) {
        const role = String((msg as { role?: string }).role ?? "unknown");
        const content = (msg as Record<string, unknown>).content;
        const inner: string[] = [];

        if (typeof content === "string") {
            if (content) inner.push(content);
        } else if (Array.isArray(content)) {
            for (const part of content as Record<string, unknown>[]) {
                switch (part.type) {
                    case "text":
                        if (typeof part.text === "string" && part.text) inner.push(part.text);
                        break;
                    case "tool-call": {
                        const id = partString(part.toolCallId);
                        const name = partString(part.toolName);
                        inner.push(`<tool_call id="${id}" name="${name}">${JSON.stringify(part.input)}</tool_call>`);
                        break;
                    }
                    case "tool-result": {
                        const id = partString(part.toolCallId);
                        const name = partString(part.toolName);
                        const output = truncate(JSON.stringify(part.output), MAX_TOOL_OUTPUT_CHARS);
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

/**
 * Synthetic judge tool exposing the assistant's transcript.
 * Returned to the judge when a criterion references `$conversation`.
 *
 * Accepts a raw ModelMessage[] conversation; serializes it for judge inspection.
 */
export class GetConversationTool {
    public static readonly toolName: string = "get_conversation";
    public static readonly keyword: string = "$conversation";
    #serialized: string;

    /**
     * @param rawConversation - The raw conversation in Vercel SDK format to be serialized.
     * @see {@link ModelMessage} for the format of the conversation in Vercel SDK.
     */
    constructor(rawConversation: ModelMessage[]) {
        this.#serialized = serializeMessages(rawConversation);
    }

    /**
     * Get the synthetic judge tool.
     * @returns The synthetic judge tool.
     */
    getTool(): Tool {
        return tool({
            description: `Returns the assistant's conversation transcript (its messages, tool calls, and tool results).
            Call this when the criteria references ${GetConversationTool.keyword}.`,
            inputSchema: z.object({}),
            execute: () => ({ conversation: this.#serialized }),
        });
    }
}
