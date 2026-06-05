import { randomUUID } from "crypto";
import { Eval } from "braintrust";
import { MongoClient } from "mongodb";

import type { UserConfig } from "../../../src/lib.js";
import {
    MongoDBClusterProcess,
    type MongoClusterConfiguration,
} from "../../integration/tools/mongodb/mongodbClusterProcess.js";
import { AccuracyTestingClient } from "../../accuracy/sdk/accuracyTestingClient.js";
import type { Model } from "../../accuracy/sdk/models.js";
import { getAvailableModels } from "../../accuracy/sdk/models.js";
import { seedCollections } from "./seeding.js";
import { runConversation } from "./testAgent.js";
import type {
    RunEvalConfig,
    RunEvalExpected,
    RunEvalInput,
    RunEvalOutput,
    RunEvalScorerArgs,
    EvalDataItem
} from "./scaffolding.types.js";

const BRAINTRUST_MCP_PROJECT = "mongodb-mcp-server-evals";
const ASSERTION_ACCURACY_SCORE = "assertion_accuracy";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveModelTemplate(template: string, model: Model): string {
    return template.replace(/<model_name>/g, model.displayName.replace(/\s+/g, "-"));
}

function defaultAccuracyUserConfig(): Partial<{ [k in keyof UserConfig]: string }> {
    return {
        apiClientId: process.env.MDB_API_CLIENT_ID,
        apiClientSecret: process.env.MDB_API_CLIENT_SECRET,
    };
}

function braintrustNoSendLogs(): boolean {
    return !process.env.BRAINTRUST_API_KEY;
}

function assertionAccuracyScorer(args: RunEvalScorerArgs): { name: string; score: number; explanation?: string } {
    return {
        name: ASSERTION_ACCURACY_SCORE,
        score: args.output.score,
        explanation: args.output.explanation,
    }
}

// ---------------------------------------------------------------------------
// Lazy infrastructure setup
// ---------------------------------------------------------------------------

interface EvalInfrastructure {
    cluster: MongoDBClusterProcess;
    seedClient: MongoClient;
    accuracyClient: AccuracyTestingClient;
}

// Defers cluster/client startup until the first task actually runs. The `pending` promise prevents duplicate
// initialization when multiple Braintrust tasks start concurrently before the first setup completes.
function createLazyInfrastructure(
    clusterConfig: MongoClusterConfiguration
): [getInfra: () => Promise<EvalInfrastructure>, closeInfra: () => Promise<void>] {
    let infra: EvalInfrastructure | null = null;
    let pending: Promise<EvalInfrastructure> | null = null;

    async function setup(): Promise<EvalInfrastructure> {
        const cluster = await MongoDBClusterProcess.spinUp(clusterConfig);
        const connectionString = cluster.connectionString();
        const seedClient = new MongoClient(connectionString);
        const userConfig = defaultAccuracyUserConfig();
        const accuracyClient = await AccuracyTestingClient.initializeClient(connectionString, userConfig);
        return { cluster, seedClient, accuracyClient };
    }

    async function getInfra(): Promise<EvalInfrastructure> {
        if (infra) return infra;
        if (!pending) {
            pending = setup().then((result) => {
                infra = result;
                return result;
            });
        }
        return pending;
    }

    async function closeInfra(): Promise<void> {
        if (!infra) return;
        const { accuracyClient, seedClient, cluster } = infra;
        await Promise.all([accuracyClient.close(), seedClient.close(), cluster.close()]);
        infra = null;
    }

    return [getInfra, closeInfra];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers Braintrust evaluators synchronously so that both `npx braintrust eval`
 * (CJS, no top-level await) and `npx tsx` work. Async infrastructure (cluster,
 * MCP client) is lazily initialized on the first task invocation.
 */
export async function runEval(config: RunEvalConfig): Promise<void> {
    const { clusterConfig, data, tags, experimentName, maxConcurrency } = config;

    if (!MongoDBClusterProcess.isConfigurationSupportedInCurrentEnv(clusterConfig)) {
        console.log("Cluster configuration not supported in current environment, skipping.");
        return;
    }

    const models = getAvailableModels();
    if (models.length === 0) {
        console.log("No models available, skipping.");
        return;
    }

    const [getInfra, closeInfra] = createLazyInfrastructure(clusterConfig);

    for (const model of models) {
        const braintrustData = data.map((item) => {
            const input: RunEvalInput = {
                userPrompt: item.input.userPrompt,
                followUpInstructions: item.input.followUpInstructions,
                followUpMaxCount: item.input.followUpMaxCount,
            };

            return {
                id: item.id,
                input,
                expected: { assertions: item.assertions } satisfies RunEvalExpected,
                metadata: { dataItem: item },
            };
        });

        await Eval(
            BRAINTRUST_MCP_PROJECT,
            {
                experimentName: resolveModelTemplate(experimentName, model),
                tags: tags.map((t) => resolveModelTemplate(t, model)),
                data: braintrustData,
                maxConcurrency,
                task: async (
                    inputData: RunEvalInput,
                    { metadata }: { metadata: { dataItem: EvalDataItem } }
                ): Promise<RunEvalOutput> => {
                    const { seedClient, accuracyClient } = await getInfra();
                    const dataItem = metadata.dataItem;
                    const input = dataItem.input;

                    // Unique DB per eval run so concurrent tasks don't share or pollute each other's collections.
                    const transientTestDb = `eval_${dataItem.id}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
                    const systemPrompt = `${input.systemPrompt}\n\nFor this session, use only the database named '${transientTestDb}'.`;

                    await seedCollections(seedClient, transientTestDb, input.dbClusterSeed.collections);

                    const tools = await accuracyClient.vercelTools();
                    try {
                        return await runConversation({
                            model,
                            tools,
                            systemPrompt,
                            input: inputData,
                            assertions: dataItem.assertions,
                        });
                    } finally {
                        await seedClient.db(transientTestDb).dropDatabase();
                    }
                },
                scores: [assertionAccuracyScorer],
            },
            { noSendLogs: braintrustNoSendLogs() }
        );
    }

    await closeInfra();
}
