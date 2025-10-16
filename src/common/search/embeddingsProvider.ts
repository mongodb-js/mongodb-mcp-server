import { createVoyage } from "voyage-ai-provider";
import type { VoyageProvider } from "voyage-ai-provider";
import { embedMany } from "ai";
import type { UserConfig } from "../config.js";
import assert from "assert";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { z } from "zod";

const zEmbeddingsInput = z.string();
type EmbeddingsInput = z.infer<typeof zEmbeddingsInput>;
type Embeddings = number[];

interface EmbeddingsProvider<SupportedModels extends string> {
    embed(modelId: SupportedModels, content: EmbeddingsInput[], parameters: unknown): Promise<Embeddings[]>;
}

const zVoyageSupportedDimensions = z
    .union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048)])
    .default(1024);

const zVoyageQuantization = z.enum(["float", "int8", "binary", "ubinary"]).default("float");
const zVoyageInputQuery = z.enum(["query", "document"]);

export const zVoyageModels = z.enum(["voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"]);
export const zVoyageParameters = {
    "voyage-3-large": z.object({
        inputType: zVoyageInputQuery,
        outputDimensions: zVoyageSupportedDimensions,
        outputDtype: zVoyageQuantization,
    }),
    "voyage-3.5": z.object({
        inputType: zVoyageInputQuery,
        outputDimensions: zVoyageSupportedDimensions,
        outputDtype: zVoyageQuantization,
    }),
    "voyage-3.5-lite": z.object({
        inputType: zVoyageInputQuery,
        outputDimensions: zVoyageSupportedDimensions,
        outputDtype: zVoyageQuantization,
    }),
    "voyage-code-3": z.object({
        inputType: zVoyageInputQuery,
        outputDimensions: zVoyageSupportedDimensions,
        outputDtype: zVoyageQuantization,
    }),
} as const;

type VoyageModels = z.infer<typeof zVoyageModels>;
class VoyageEmbeddingsProvider implements EmbeddingsProvider<VoyageModels> {
    private readonly voyage: VoyageProvider;

    constructor(userConfig: UserConfig, providedFetch?: typeof fetch) {
        assert(userConfig.voyageApiKey, "voyageApiKey does not exist. This is likely a bug.");

        const customFetch: typeof fetch = (providedFetch ??
            createFetch({ useEnvironmentVariableProxies: true })) as unknown as typeof fetch;

        this.voyage = createVoyage({ apiKey: userConfig.voyageApiKey, fetch: customFetch });
    }

    static isConfiguredIn(userConfig: UserConfig): boolean {
        return !!userConfig.voyageApiKey;
    }

    async embed<Model extends VoyageModels>(
        modelId: Model,
        content: EmbeddingsInput[],
        parameters: z.infer<(typeof zVoyageParameters)[Model]>
    ): Promise<Embeddings[]> {
        const model = this.voyage.textEmbeddingModel(modelId);
        const { embeddings } = await embedMany({ model, values: content, providerOptions: { voyage: parameters } });
        return embeddings;
    }
}

export function getEmbeddingsProvider(userConfig: UserConfig): EmbeddingsProvider<VoyageModels> | undefined {
    if (VoyageEmbeddingsProvider.isConfiguredIn(userConfig)) {
        return new VoyageEmbeddingsProvider(userConfig);
    }

    return undefined;
}
