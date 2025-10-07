import { EmbeddingProvider } from './embeddingProvider.js';

/**
 * Configuration for the Azure AI Inference embedding provider.
 */
export interface AzureAIInferenceEmbeddingConfig {
  endpoint: string;          // Full endpoint URL for embeddings request
  apiKey: string;            // API key (sent as api-key header)
  deployment: string;        // Deployment or model name
  dimension?: number;        // Optional dimension override
  maxRetries?: number;       // Maximum retry attempts for transient errors
  initialDelayMs?: number;   // Initial backoff delay
}

/**
 * Embedding provider implementation backed by Azure AI Inference embeddings endpoint.
 * Performs simple exponential backoff retries on transient failures (429 / 5xx).
 */
export class AzureAIInferenceEmbeddingProvider implements EmbeddingProvider {
  public name = 'azure-ai-inference';
  private readonly config: AzureAIInferenceEmbeddingConfig;

  constructor(config: AzureAIInferenceEmbeddingConfig) {
    this.config = config;
  }

  async embed(input: string[]): Promise<number[][]> {
    if (input.length === 0) return [];

    // Construct request payload; future optimization could batch requests.
    const body: Record<string, unknown> = {
      model: this.config.deployment,
      input,
      input_type: 'query'
    };
    if (this.config.dimension) {
      (body as any).dimensions = this.config.dimension; // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    const maxRetries = this.config.maxRetries ?? 2;
    const initialDelay = this.config.initialDelayMs ?? 200;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt <= maxRetries) {
      const res = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const transient = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!transient) {
          throw new Error(`Embedding request failed with status ${res.status}, statusText: ${res.statusText}, response: ${await res.text()}`);
        }
        lastError = new Error(`Transient status ${res.status}`);
      } else {
        const json = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const data = json?.data;
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('Embedding response malformed: missing data array');
        }
        const embeddings: number[][] = [];
        for (const item of data) {
          const emb = item?.embedding;
          if (!Array.isArray(emb)) {
            throw new Error('Embedding response malformed: item.embedding missing or not array');
          }
          embeddings.push(emb as number[]);
        }
        return embeddings;
      }

      if (attempt === maxRetries) break;
      const delay = Math.round(initialDelay * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5));
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }

    throw new Error(`Embedding request ultimately failed after ${maxRetries + 1} attempt(s): ${lastError?.message}`);
  }
}
