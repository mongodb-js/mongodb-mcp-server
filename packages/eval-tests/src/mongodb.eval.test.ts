import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOOP_SPAN } from "braintrust";
import type * as Braintrust from "braintrust";
import { createOpenAI } from "@ai-sdk/openai";
import { MongoClient } from "mongodb";
import type { ModelMessage } from "ai";
import type { RunEvalExpected, RunEvalInput, RunEvalOutput } from "./lib/datasetTypes.js";
import type { EvalParametersBtSchema } from "./lib/evalTypes.js";
import * as shared from "./lib/shared.js";
import { seedTempDb } from "./lib/seeding.js";
import { runTask } from "./lib/user.js";
import { judgeUsingLLM } from "./lib/judge.js";
import { GetConversationTool } from "./lib/tool/getConversation.js";
import { GetResponseTool } from "./lib/tool/getResponse.js";
import "./mongodb.eval.js";

type EvalDefinition = Parameters<
    typeof Braintrust.Eval<RunEvalInput, RunEvalOutput, RunEvalExpected, void, boolean, typeof EvalParametersBtSchema>
>[1];
type TaskHooks = Parameters<EvalDefinition["task"]>[1];

const registration = vi.hoisted((): { evaluator?: EvalDefinition } => ({}));

vi.mock("braintrust", async (importOriginal) => {
    const original = await importOriginal<typeof Braintrust>();
    return {
        ...original,
        Eval: vi.fn((_name: string, evaluator: EvalDefinition): void => {
            registration.evaluator = evaluator;
        }),
        initDataset: vi.fn(() => []),
        Reporter: vi.fn(),
    };
});
vi.mock("./lib/shared.js", () => ({
    getAiProvider: vi.fn(),
    registerConnectionString: vi.fn(),
    registerTempDb: vi.fn(),
    getMongoDbClient: vi.fn(),
    getMcpClient: vi.fn(),
    getReadOnlyMcpClient: vi.fn(),
    dropCaseDb: vi.fn(),
    teardown: vi.fn(),
}));
vi.mock("./lib/seeding.js", () => ({ seedTempDb: vi.fn() }));
vi.mock("./lib/user.js", () => ({ runTask: vi.fn() }));
vi.mock("./lib/judge.js", () => ({ judgeUsingLLM: vi.fn() }));

function getTask(): EvalDefinition["task"] {
    if (!registration.evaluator) {
        throw new Error("The MongoDB evaluator was not registered");
    }
    return registration.evaluator.task;
}

function createHooks(): TaskHooks {
    return {
        meta: vi.fn(),
        metadata: {},
        expected: {},
        span: NOOP_SPAN,
        parameters: {
            connectionString: "mongodb://127.0.0.1:27017",
            model: "mock-agent",
            judgeModel: "mock-judge",
            systemContext: "Test system context.",
            validateReferenceAnswer: false,
        },
        reportProgress: vi.fn(),
        trialIndex: 0,
        tags: undefined,
    };
}

describe("MongoDB eval task", () => {
    const dbClient = new MongoClient("mongodb://127.0.0.1:27017");
    const messages: ModelMessage[] = [
        { role: "user", content: "Count movies from the year I supply next." },
        { role: "assistant", content: "Which year?" },
        { role: "user", content: "Use 1999." },
        { role: "assistant", content: "There are 3 movies." },
    ];
    const response = "There are 3 movies.";

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(shared.getAiProvider).mockResolvedValue(createOpenAI({ apiKey: "unused-in-unit-tests" }));
        vi.mocked(shared.getMongoDbClient).mockResolvedValue(dbClient);
        vi.mocked(shared.getMcpClient).mockResolvedValue({
            tools: vi.fn().mockResolvedValue({}),
            close: vi.fn().mockResolvedValue(undefined),
        });
        vi.mocked(shared.getReadOnlyMcpClient).mockResolvedValue({
            tools: vi.fn().mockResolvedValue({}),
            close: vi.fn().mockResolvedValue(undefined),
        });
        vi.mocked(seedTempDb).mockResolvedValue(undefined);
        vi.mocked(shared.dropCaseDb).mockResolvedValue(undefined);
        vi.mocked(runTask).mockResolvedValue({ response, messages });
        vi.mocked(judgeUsingLLM).mockResolvedValue({ score: 1, explanation: "The script was completed." });
    });

    it("runs the whole script between one database seed and cleanup", async () => {
        const input = {
            prompt: "Count movies from the year I supply next.",
            follow_up_prompts: ["Use 1999."],
            db_seed: ["movies"],
        };
        const hooks = createHooks();

        const result = await getTask()(input, hooks);

        const dbName = vi.mocked(shared.registerTempDb).mock.calls[0]?.[0];
        expect(dbName).toMatch(/^eval_/);
        expect(seedTempDb).toHaveBeenCalledExactlyOnceWith({ dbClient, db: dbName, dbSeed: input.db_seed });
        expect(runTask).toHaveBeenCalledOnce();
        const task = vi.mocked(runTask).mock.calls[0]?.[0];
        expect(task?.model).toBeDefined();
        expect(task).toMatchObject({
            systemContext: hooks.parameters.systemContext,
            tools: {},
            prompt: input.prompt,
            followUpPrompts: input.follow_up_prompts,
            tempDbName: dbName,
            stepLimit: 10,
        });
        expect(shared.dropCaseDb).toHaveBeenCalledExactlyOnceWith(dbName);
        expect(vi.mocked(seedTempDb).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(runTask).mock.invocationCallOrder[0]!
        );
        expect(vi.mocked(runTask).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(shared.dropCaseDb).mock.invocationCallOrder[0]!
        );
        expect(result).toEqual({ response, judge: undefined });
    });

    it("exposes the complete conversation and final response to the judge", async () => {
        const hooks = createHooks();
        hooks.expected.llm_judge = "Check $conversation and $response.";

        const result = await getTask()({ prompt: "Count movies.", follow_up_prompts: ["Use 1999."] }, hooks);

        expect(judgeUsingLLM).toHaveBeenCalledOnce();
        const judge = vi.mocked(judgeUsingLLM).mock.calls[0]?.[0];
        const conversation: unknown = await judge?.tools[GetConversationTool.toolName]?.execute?.(
            {},
            { toolCallId: "inspect-conversation", messages: [] }
        );
        const finalResponse: unknown = await judge?.tools[GetResponseTool.toolName]?.execute?.(
            {},
            { toolCallId: "inspect-response", messages: [] }
        );
        expect(conversation).toHaveProperty(
            "conversation",
            expect.stringContaining(
                '<turn n="2" role="assistant">\nWhich year?\n</turn>\n<turn n="3" role="user">\nUse 1999.\n</turn>'
            )
        );
        expect(finalResponse).toEqual({ response });
        expect(result).toEqual({ response, judge: { score: 1, explanation: "The script was completed." } });
    });

    it("forwards existing single-turn inputs without a script", async () => {
        await getTask()({ prompt: "Count movies." }, createHooks());

        expect(runTask).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ prompt: "Count movies.", followUpPrompts: undefined })
        );
    });

    it("keeps reference-answer validation single-turn even when the input has scripted replies", async () => {
        const hooks = createHooks();
        hooks.parameters.validateReferenceAnswer = true;
        hooks.expected.reference_answer = "Count all documents in movies.";

        await getTask()({ prompt: "Do not use this prompt.", follow_up_prompts: ["Do not send this reply."] }, hooks);

        expect(runTask).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                prompt: "Execute the following reference answer:\n\n```\nCount all documents in movies.\n```",
                followUpPrompts: undefined,
            })
        );
    });

    it("cleans up the case database when script execution fails", async () => {
        const error = new Error("The task step budget was exhausted");
        vi.mocked(runTask).mockRejectedValueOnce(error);

        await expect(
            getTask()({ prompt: "Count movies.", follow_up_prompts: ["Refine the count."] }, createHooks())
        ).rejects.toBe(error);

        expect(shared.dropCaseDb).toHaveBeenCalledExactlyOnceWith(vi.mocked(shared.registerTempDb).mock.calls[0]?.[0]);
        expect(judgeUsingLLM).not.toHaveBeenCalled();
    });

    it("cleans up without running the agent when database seeding fails", async () => {
        const error = new Error("Seeding failed");
        vi.mocked(seedTempDb).mockRejectedValueOnce(error);

        await expect(
            getTask()({ prompt: "Count movies.", follow_up_prompts: ["Use 1999."] }, createHooks())
        ).rejects.toBe(error);

        expect(shared.dropCaseDb).toHaveBeenCalledExactlyOnceWith(vi.mocked(shared.registerTempDb).mock.calls[0]?.[0]);
        expect(runTask).not.toHaveBeenCalled();
        expect(shared.getMcpClient).not.toHaveBeenCalled();
    });
});
