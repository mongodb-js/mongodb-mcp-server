import { createVoyage } from "voyage-ai-provider";
import type { VoyageProvider } from "voyage-ai-provider";
import { embedMany } from "ai";
import type { UserConfig } from "../config.js";
import assert from "assert";
import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { z } from "zod";

type EmbeddingsInput = string;
type Embeddings = number[];
export type EmbeddingParameters = {
    inputType: "query" | "document";
};

export interface EmbeddingsProvider<
    SupportedModels extends string,
    SupportedEmbeddingParameters extends EmbeddingParameters,
> {
    embed(
        modelId: SupportedModels,
        content: EmbeddingsInput[],
        parameters: SupportedEmbeddingParameters
    ): Promise<Embeddings[]>;
}

export const zVoyageModels = z
    .enum(["voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"])
    .default("voyage-3-large");

export const zVoyageEmbeddingParameters = z.object({
    outputDimension: z
        .union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)])
        .optional()
        .default(1024),
    outputDType: z.enum(["float", "int8", "uint8", "binary", "ubinary"]).optional().default("float"),
});

type VoyageModels = z.infer<typeof zVoyageModels>;
type VoyageEmbeddingParameters = z.infer<typeof zVoyageEmbeddingParameters> & EmbeddingParameters;

class VoyageEmbeddingsProvider implements EmbeddingsProvider<VoyageModels, VoyageEmbeddingParameters> {
    private readonly voyage: VoyageProvider;

    constructor({ voyageApiKey }: UserConfig, providedFetch?: typeof fetch) {
        assert(voyageApiKey, "The VoyageAI API Key does not exist. This is likely a bug.");

        // We should always use, by default, any enterprise proxy that the user has configured.
        // Direct requests to VoyageAI might get blocked by the network if they don't go through
        // the provided proxy.
        const customFetch: typeof fetch = (providedFetch ??
            createFetch({ useEnvironmentVariableProxies: true })) as unknown as typeof fetch;

        this.voyage = createVoyage({ apiKey: voyageApiKey, fetch: customFetch });
    }

    static isConfiguredIn({ voyageApiKey, previewFeatures }: UserConfig): boolean {
        return previewFeatures.includes("vectorSearch") && !!voyageApiKey;
    }

    async embed<Model extends VoyageModels>(
        modelId: Model,
        content: EmbeddingsInput[],
        parameters: VoyageEmbeddingParameters
    ): Promise<Embeddings[]> {
        const model = this.voyage.textEmbeddingModel(modelId);
        const { embeddings } = await embedMany({
            model,
            values: content,
            providerOptions: { voyage: parameters },
        });

        return embeddings;
    }
}

export function getEmbeddingsProvider(
    userConfig: UserConfig
): EmbeddingsProvider<VoyageModels, VoyageEmbeddingParameters> | undefined {
    if (VoyageEmbeddingsProvider.isConfiguredIn(userConfig)) {
        return new VoyageEmbeddingsProvider(userConfig);
    }

    return undefined;
}

export const zSupportedEmbeddingParameters = zVoyageEmbeddingParameters.extend({ model: zVoyageModels });
export type SupportedEmbeddingParameters = z.infer<typeof zSupportedEmbeddingParameters>;
