import { describe, it, expect, vi } from 'vitest';
import { AzureAIInferenceEmbeddingProvider } from '../../../src/embedding/azureAIInferenceEmbeddingProvider.js';

const baseConfig = {
  endpoint: 'https://example.com/embeddings',
  apiKey: 'KEY',
  deployment: 'model',
  maxRetries: 2,
  initialDelayMs: 10,
};

describe('AzureAIInferenceEmbeddingProvider retry logic', () => {
  it('retries transient 500 then succeeds', async () => {
    const provider = new AzureAIInferenceEmbeddingProvider(baseConfig);
    const fakeEmbedding = [0.1,0.2];
    const responses = [
      { ok: false, status: 500 },
      { ok: true, status: 200, json: async () => ({ data: [{ embedding: fakeEmbedding }] }) }
    ];
    let call = 0;
    global.fetch = vi.fn().mockImplementation(() => responses[call++]);

    const result = await provider.embed(['hello']);
    expect(result[0]).toEqual(fakeEmbedding);
    expect((fetch as any).mock.calls.length).toBe(2);
  });

  it('fails after max retries', async () => {
    const provider = new AzureAIInferenceEmbeddingProvider({ ...baseConfig, maxRetries: 1, initialDelayMs: 5 });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(provider.embed(['hello'])).rejects.toThrow(/ultimately failed/);
    expect((fetch as any).mock.calls.length).toBe(2); // initial + 1 retry
  });

  it('does not retry on 400', async () => {
    const provider = new AzureAIInferenceEmbeddingProvider(baseConfig);
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
      json: async () => ({ error: 'Bad Request' })
    });
    await expect(provider.embed(['hello'])).rejects.toThrow(/status 400/);
    expect((fetch as any).mock.calls.length).toBe(1);
  });
});
