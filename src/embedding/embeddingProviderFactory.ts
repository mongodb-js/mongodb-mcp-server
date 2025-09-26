import type { UserConfig } from "../common/config.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import { AzureAIInferenceEmbeddingProvider } from "./azureAIInferenceEmbeddingProvider.js";

/**
 * Factory responsible for creating an EmbeddingProvider implementation
 * based on the user configuration. Centralizing this logic allows
 * additional providers to be added in the future without touching tool code.
 */
export class EmbeddingProviderFactory {
    /**
     * Create an embedding provider instance based on configuration.
     * Currently supports:
     *  - azure-ai-inference (default)
     */
    static create(config: UserConfig): EmbeddingProvider {
        // Default to azure-ai-inference if not set
        if (!config.embeddingModelProvider) {
            config.embeddingModelProvider = "azure-ai-inference";
        }

        switch (config.embeddingModelProvider) {
            case "azure-ai-inference":
                return EmbeddingProviderFactory.GetAzureAIInferenceEmbeddingProvider(config);
            default:
                throw new Error(`Unsupported embedding model provider: ${config.embeddingModelProvider}.`);
        }
    }

    /**
     * Lightweight boolean validation indicating whether the provided config
     * contains the minimum required fields to construct an embedding provider
     * for the currently selected provider (or default provider). This does NOT
     * throw – it is intended for tooling guard rails (e.g. verifyAllowed checks)
     * where we just want to short‑circuit availability.
     */
    static isEmbeddingConfigValid(config: UserConfig): boolean {
        // Default to azure-ai-inference if not set
        if (!config.embeddingModelProvider) {
            config.embeddingModelProvider = "azure-ai-inference";
        }

        switch (config.embeddingModelProvider) {
            case "azure-ai-inference": {
                return !!(
                    config.embeddingModelEndpoint &&
                    config.embeddingModelApikey &&
                    config.embeddingModelDeploymentName
                );
            }
            default:
                // Unknown provider – explicitly invalid (create() will throw anyway)
                return false;
        }
    }

    /**
     * Assertion variant of validation – throws a descriptive error when the
     * configuration is incomplete for the selected provider. This centralizes
     * error message wording so tools and factory creation stay consistent.
     */
    static assertEmbeddingConfigValid(config: UserConfig): void {
        if (!this.isEmbeddingConfigValid(config)) {
            throw new Error(
                `Embedding model config incomplete or invalid for provider '${config.embeddingModelProvider}'. `
            );
        }
    }

    static GetAzureAIInferenceEmbeddingProvider(config: UserConfig): EmbeddingProvider {
        // Reuse centralized validation
        this.assertEmbeddingConfigValid(config);

        const endpoint = config.embeddingModelEndpoint!;
        const apiKey = config.embeddingModelApikey!;
        const deployment = config.embeddingModelDeploymentName!;
        const dimension = config.embeddingModelDimension!;

        return new AzureAIInferenceEmbeddingProvider({
            endpoint,
            apiKey,
            deployment,
            dimension,
            maxRetries: 2,
            initialDelayMs: 200,
        });
    }
}

export function createEmbeddingProvider(config: UserConfig): EmbeddingProvider {
    return EmbeddingProviderFactory.create(config);
}