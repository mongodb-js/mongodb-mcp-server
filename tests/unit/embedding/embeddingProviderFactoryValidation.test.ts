import { describe, it, expect } from "vitest";
import { EmbeddingProviderFactory } from "../../../src/embedding/embeddingProviderFactory.js";
import type { UserConfig } from "../../../src/common/config.js";

function baseConfig(): Partial<UserConfig> {
  return {
    embeddingModelProvider: "azure-ai-inference",
    embeddingModelEndpoint: "https://example/",
    embeddingModelApikey: "key",
    embeddingModelDeploymentName: "deploy",
    embeddingModelDimension: 1536,
  } as Partial<UserConfig>;
}

describe("EmbeddingProviderFactory.isEmbeddingConfigValid", () => {
  it("returns true for complete azure-ai-inference config", () => {
    const cfg = baseConfig() as UserConfig;
    expect(EmbeddingProviderFactory.isEmbeddingConfigValid(cfg)).toBe(true);
  });

  it("returns false when a required field missing", () => {
    const cfg = baseConfig();
    delete cfg.embeddingModelApikey;
    expect(EmbeddingProviderFactory.isEmbeddingConfigValid(cfg as UserConfig)).toBe(false);
  });

  it("throws with assertEmbeddingConfigValid when invalid", () => {
    const cfg = baseConfig();
    delete cfg.embeddingModelDeploymentName;
    expect(() => EmbeddingProviderFactory.assertEmbeddingConfigValid(cfg as UserConfig)).toThrow();
  });
});
