import type { EvalScorerArgs } from "braintrust";
import type { SeedCollectionData } from "./seeding.js";
import type { MongoClusterConfiguration } from "../../../integration/tools/mongodb/mongodbClusterProcess.js";
import { ModelMessage } from "ai";

export interface RunEvalConfig {
    clusterConfig: MongoClusterConfiguration;
    maxConcurrency?: number;
    experimentName: string;
    id: string;
    tags: string[];
    data: EvalDataItem[];
}

export interface EvalDataItem {
    id: string;
    input: {
        systemPrompt: string;
        userPrompt: string;
        followUpInstructions?: string | string[];
        followUpMaxCount?: number;
        dbClusterSeed: {
            collections: SeedCollectionData[];
        };
    };
    assertions: string | string[];
}

export interface Verdict {
    score: number;
    explanation?: string;
}

// Intentional subset of EvalDataItem.input — dbClusterSeed and systemPrompt are injected by the task runner, not stored in Braintrust.
export type RunEvalInput = { userPrompt: string; followUpInstructions?: string | string[]; followUpMaxCount?: number };
export type RunEvalOutput = Verdict;
export type RunEvalExpected = { assertions: string | string[] };
export type RunEvalScorerArgs = EvalScorerArgs<RunEvalInput, RunEvalOutput, RunEvalExpected>;

export type FollowUpResult =
    | { hasFollowUp: true; response: string }
    | { hasFollowUp: false };
