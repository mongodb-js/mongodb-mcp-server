import { describe, expect, it, vi, type Mock } from "vitest";
import { tool, type FinishReason, type ToolSet } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { runTask } from "./user.js";

vi.mock("braintrust", () => ({
    wrapAISDK: <T>(sdk: T): T => sdk,
}));

type ModelResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

const baseTask = {
    systemContext: "Test system context.",
    tools: {},
    prompt: "Count the movies.",
    tempDbName: "eval_scripted_test",
};

function textResponse(text: string, finishReason: FinishReason = "stop"): ModelResult {
    return {
        content: [{ type: "text", text }],
        finishReason: { unified: finishReason, raw: finishReason },
        usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
    };
}

function toolResponse(toolCallId: string): ModelResult {
    return {
        ...textResponse(""),
        content: [
            {
                type: "tool-call",
                toolCallId,
                toolName: "count",
                input: JSON.stringify({ database: baseTask.tempDbName }),
            },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
    };
}

function createTools(): { tools: ToolSet; execute: Mock<(input: { database: string }) => number> } {
    const execute = vi.fn<(input: { database: string }) => number>().mockReturnValue(3);
    return {
        tools: { count: tool({ inputSchema: z.object({ database: z.string() }), execute }) },
        execute,
    };
}

describe("runTask", () => {
    it.each([{ followUpPrompts: undefined }, { followUpPrompts: [] }])(
        "preserves single-turn behavior for follow-ups $followUpPrompts",
        async ({ followUpPrompts }) => {
            const model = new MockLanguageModelV3({ doGenerate: textResponse("There are 3 movies.") });

            const result = await runTask({ ...baseTask, model, followUpPrompts });

            expect(model.doGenerateCalls).toHaveLength(1);
            expect(model.doGenerateCalls[0]?.prompt).toEqual([
                {
                    role: "system",
                    content: `${baseTask.systemContext}\n    \n    All operations must target the MongoDB database named "${baseTask.tempDbName}".\n    Always pass this database name to any tool that accepts a database argument, and never use any other database.`,
                },
                { role: "user", content: [{ type: "text", text: baseTask.prompt }] },
            ]);
            expect(result).toEqual({
                response: "There are 3 movies.",
                messages: [
                    { role: "user", content: baseTask.prompt },
                    { role: "assistant", content: [{ type: "text", text: "There are 3 movies." }] },
                ],
            });
        }
    );

    it("sends scripted replies only after completed turns and preserves the full tool transcript", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: [
                textResponse("Which year?"),
                toolResponse("count-1999"),
                textResponse("There are 3 movies from 1999."),
                textResponse("The refined count is 2."),
            ],
        });
        const { tools, execute } = createTools();
        const followUpPrompts = ["Use 1999.", "Now only include movies under 100 minutes."];

        const result = await runTask({ ...baseTask, model, tools, followUpPrompts });

        expect(model.doGenerateCalls).toHaveLength(4);
        expect(model.doGenerateCalls[0]?.prompt.map(({ role }) => role)).toEqual(["system", "user"]);
        expect(model.doGenerateCalls[1]?.prompt).toEqual([
            expect.objectContaining({ role: "system" }),
            { role: "user", content: [{ type: "text", text: baseTask.prompt }] },
            { role: "assistant", content: [{ type: "text", text: "Which year?" }] },
            { role: "user", content: [{ type: "text", text: followUpPrompts[0] }] },
        ]);
        expect(model.doGenerateCalls[3]?.prompt.map(({ role }) => role)).toEqual([
            "system",
            "user",
            "assistant",
            "user",
            "assistant",
            "tool",
            "assistant",
            "user",
        ]);
        expect(model.doGenerateCalls[3]?.prompt.at(-1)).toEqual({
            role: "user",
            content: [{ type: "text", text: followUpPrompts[1] }],
        });
        expect(result).toEqual({
            response: "The refined count is 2.",
            messages: [
                { role: "user", content: baseTask.prompt },
                { role: "assistant", content: [{ type: "text", text: "Which year?" }] },
                { role: "user", content: followUpPrompts[0] },
                {
                    role: "assistant",
                    content: [
                        {
                            type: "tool-call",
                            toolCallId: "count-1999",
                            toolName: "count",
                            input: { database: baseTask.tempDbName },
                        },
                    ],
                },
                {
                    role: "tool",
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: "count-1999",
                            toolName: "count",
                            output: { type: "json", value: 3 },
                        },
                    ],
                },
                { role: "assistant", content: [{ type: "text", text: "There are 3 movies from 1999." }] },
                { role: "user", content: followUpPrompts[1] },
                { role: "assistant", content: [{ type: "text", text: "The refined count is 2." }] },
            ],
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]?.[0]).toEqual({ database: baseTask.tempDbName });
        for (const call of model.doGenerateCalls) {
            expect(call.prompt[0]?.role).toBe("system");
            expect(call.prompt[0]?.content).toContain(
                'All operations must target the MongoDB database named "eval_scripted_test"'
            );
            expect(call.prompt[0]?.content).toContain(
                "Single-turn-only and no-clarification instructions above do not apply."
            );
            expect(call.tools).toEqual([expect.objectContaining({ name: "count" })]);
        }
    });

    it("completes ten user turns within the default shared step budget", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: Array.from({ length: 10 }, (_, index) => textResponse(`Answer ${index + 1}`)),
        });
        const followUpPrompts = Array.from({ length: 9 }, (_, index) => `Reply ${index + 1}`);

        const result = await runTask({ ...baseTask, model, followUpPrompts });

        expect(model.doGenerateCalls).toHaveLength(10);
        expect(result.response).toBe("Answer 10");
        expect(result.messages.filter(({ role }) => role === "user").map(({ content }) => content)).toEqual([
            baseTask.prompt,
            ...followUpPrompts,
        ]);
    });

    it("preserves the default ten-step tool limit for single-turn cases", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: Array.from({ length: 11 }, (_, index) => toolResponse(`count-${index}`)),
        });
        const { tools, execute } = createTools();

        const result = await runTask({ ...baseTask, model, tools });

        expect(model.doGenerateCalls).toHaveLength(10);
        expect(execute).toHaveBeenCalledTimes(10);
        expect(result.response).toBe("The LLM model was stopped unexpectedly because of [tool-calls] tool_calls.\n");
    });

    it("does not reset the tool-step budget for follow-ups or send replies after an abnormal finish", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: [
                toolResponse("initial"),
                textResponse("The count is 3."),
                toolResponse("follow-up-1"),
                toolResponse("follow-up-2"),
                textResponse("This must not run."),
            ],
        });
        const { tools, execute } = createTools();

        const result = await runTask({
            ...baseTask,
            model,
            tools,
            followUpPrompts: ["Recount.", "This user reply must not be sent."],
            stepLimit: 4,
        });

        expect(model.doGenerateCalls).toHaveLength(4);
        expect(execute).toHaveBeenCalledTimes(3);
        expect(result.messages.filter(({ role }) => role === "user").map(({ content }) => content)).toEqual([
            baseTask.prompt,
            "Recount.",
        ]);
        expect(result.response).toBe("The LLM model was stopped unexpectedly because of [tool-calls] tool_calls.\n");
    });

    it("fails explicitly when completed turns exhaust the budget before the script ends", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: [textResponse("Which year?"), textResponse("The count is 3.")],
        });

        await expect(
            runTask({
                ...baseTask,
                model,
                followUpPrompts: ["Use 1999.", "Now refine the count."],
                stepLimit: 2,
            })
        ).rejects.toThrow(
            "The LLM model exhausted the task step limit [2] before all scripted user turns were processed."
        );
        expect(model.doGenerateCalls).toHaveLength(2);
    });

    it.each(["length", "content-filter", "error", "other"] as const)(
        "preserves the existing %s finish diagnostic and stops the script",
        async (finishReason) => {
            const model = new MockLanguageModelV3({
                doGenerate: [textResponse("Which year?"), textResponse("Partial answer.", finishReason)],
            });

            const result = await runTask({
                ...baseTask,
                model,
                followUpPrompts: ["Use 1999.", "Do not send this."],
            });

            expect(model.doGenerateCalls).toHaveLength(2);
            expect(result.response).toBe(
                `The LLM model was stopped unexpectedly because of [${finishReason}] ${finishReason}.\nPartial answer.`
            );
            expect(result.messages.at(-1)).toEqual({
                role: "assistant",
                content: [{ type: "text", text: "Partial answer." }],
            });
        }
    );

    it("propagates model errors without sending the remaining script", async () => {
        const error = new Error("Model boundary failed");
        const doGenerate = vi
            .fn<MockLanguageModelV3["doGenerate"]>()
            .mockResolvedValueOnce(textResponse("Which year?"))
            .mockRejectedValue(error);
        const model = new MockLanguageModelV3({ doGenerate });

        await expect(runTask({ ...baseTask, model, followUpPrompts: ["Use 1999.", "Do not send this."] })).rejects.toBe(
            error
        );
        expect(model.doGenerateCalls).toHaveLength(2);
    });

    it("retains SDK tool-error results in the conversation seen by later turns", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: [
                toolResponse("failed-count"),
                textResponse("The count tool failed."),
                textResponse("No count was available."),
            ],
        });
        const execute = vi.fn<(input: { database: string }) => number>(() => {
            throw new Error("Count failed");
        });
        const tools = { count: tool({ inputSchema: z.object({ database: z.string() }), execute }) };

        const result = await runTask({ ...baseTask, model, tools, followUpPrompts: ["Explain the failure."] });

        expect(execute).toHaveBeenCalledOnce();
        expect(result.messages[2]).toMatchObject({
            role: "tool",
            content: [
                {
                    type: "tool-result",
                    toolCallId: "failed-count",
                    output: { type: "error-text", value: "Count failed" },
                },
            ],
        });
        expect(model.doGenerateCalls[2]?.prompt.find(({ role }) => role === "tool")).toMatchObject({
            role: "tool",
            content: [{ output: { type: "error-text", value: "Count failed" } }],
        });
        expect(result.response).toBe("No count was available.");
    });

    it("keeps concurrent case histories and database instructions isolated", async () => {
        const firstModel = new MockLanguageModelV3({
            doGenerate: [textResponse("First question."), textResponse("First answer.")],
        });
        const secondModel = new MockLanguageModelV3({
            doGenerate: [textResponse("Second question."), textResponse("Second answer.")],
        });

        const [first, second] = await Promise.all([
            runTask({ ...baseTask, model: firstModel, tempDbName: "eval_first", followUpPrompts: ["First reply."] }),
            runTask({ ...baseTask, model: secondModel, tempDbName: "eval_second", followUpPrompts: ["Second reply."] }),
        ]);

        expect(first.messages).not.toContainEqual({ role: "user", content: "Second reply." });
        expect(second.messages).not.toContainEqual({ role: "user", content: "First reply." });
        for (const call of firstModel.doGenerateCalls) {
            expect(call.prompt[0]?.content).toContain('database named "eval_first"');
        }
        for (const call of secondModel.doGenerateCalls) {
            expect(call.prompt[0]?.content).toContain('database named "eval_second"');
        }
    });

    it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
        "rejects invalid step limit %s before calling the model",
        async (stepLimit) => {
            const model = new MockLanguageModelV3();

            await expect(runTask({ ...baseTask, model, stepLimit })).rejects.toThrow(
                "stepLimit must be a positive safe integer"
            );
            expect(model.doGenerateCalls).toHaveLength(0);
        }
    );

    it.each([{ followUpPrompts: [""] }, { followUpPrompts: Array.from({ length: 10 }, () => "Continue.") }])(
        "validates scripted replies before calling the model: $followUpPrompts",
        async ({ followUpPrompts }) => {
            const model = new MockLanguageModelV3();

            await expect(runTask({ ...baseTask, model, followUpPrompts })).rejects.toThrow();
            expect(model.doGenerateCalls).toHaveLength(0);
        }
    );
});
