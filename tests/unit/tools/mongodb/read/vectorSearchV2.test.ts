import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VectorSearchV2Tool } from "../../../../../src/tools/mongodb/read/vectorSearchv2.js";
import { Session } from "../../../../../src/common/session.js";
import EventEmitter from "events";
import { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import { Elicitation } from "../../../../../src/elicitation.js";

// Mock service provider implementing only aggregate
class MockServiceProviderV2 {
  public aggregateCalls: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  aggregate(_db: string, _coll: string, pipeline: any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.aggregateCalls.push(pipeline);
    return { toArray: async () => ([{ _id: 1, embedding: [0.1,0.2,0.3], title: "Doc" }]) };
  }
}

describe("VectorSearchV2Tool", () => {
  const originalFetch = global.fetch;
  let session: Session;
  let tool: VectorSearchV2Tool;
  let provider: MockServiceProviderV2;

  function buildSessionAndTool(overrides: Record<string, any> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const connectionEvents = new EventEmitter();
    const connectionManager: any = {
      events: connectionEvents,
      currentConnectionState: { tag: "connected", serviceProvider: undefined, connectedAtlasCluster: undefined },
      setClientName: () => undefined,
      disconnect: async () => undefined,
    };
    provider = new MockServiceProviderV2();
    connectionManager.currentConnectionState.serviceProvider = provider as any;

    const exportsManager: any = { close: async () => undefined };
    const keychain: any = { register: () => undefined };
    const logger: any = { debug: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined };

    session = new Session({ apiBaseUrl: "https://example.com/", logger, connectionManager, exportsManager, keychain });
    const baseConfig = {
      disabledTools: [],
      confirmationRequiredTools: [],
      readOnly: false,
      indexCheck: false,
      transport: "stdio",
      loggers: ["stderr"],
      telemetry: "disabled",
      embeddingModelEndpoint: "https://example.test/embeddings",
      embeddingModelApikey: "key",
      embeddingModelDeploymentName: "text-embed",
      embeddingModelDimension: 3,
      vectorSearchPath: "embedding",
      vectorSearchIndex: "vector_index",
    } as any;

    const config = { ...baseConfig, ...overrides };
    const telemetry = Telemetry.create(session as any, config, { get: async () => "device-id" } as any);
    const elicitation = new Elicitation({ server: { getClientCapabilities: () => ({}) } as any });
    tool = new VectorSearchV2Tool({ session: session as any, config, telemetry: telemetry as any, elicitation: elicitation as any });
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [0.9, 0.8, 0.7] }] }) }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    buildSessionAndTool();
  });

  afterEach(() => { global.fetch = originalFetch; });

  // verifyAllowed scenarios (mirroring pattern used in V1 tests but adapted for V2 semantics)
  it("verifyAllowed returns true when all required config present", () => {
    expect((tool as any).verifyAllowed()).toBe(true);
  });

  it("verifyAllowed returns false when path missing", () => {
    buildSessionAndTool({ vectorSearchPath: undefined });
    expect((tool as any).verifyAllowed()).toBe(false);
  });

  it("verifyAllowed returns false when index missing", () => {
    buildSessionAndTool({ vectorSearchIndex: undefined });
    expect((tool as any).verifyAllowed()).toBe(false);
  });

  it("verifyAllowed returns false when unsupported provider specified", () => {
    buildSessionAndTool({ embeddingModelProvider: "other-provider" });
    expect((tool as any).verifyAllowed()).toBe(false);
  });

  it("embeds queryText using config path & index", async () => {
    const res = await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello world", limit: 4, numCandidates: 50, includeVector: false });
    expect(res).toBeDefined();
    expect(global.fetch).toHaveBeenCalledOnce();
    const pipeline = provider.aggregateCalls[0];
    expect(pipeline[0].$vectorSearch.path).toBe("embedding");
    expect(pipeline[0].$vectorSearch.index).toBe("vector_index");
    expect(pipeline[0].$vectorSearch.queryVector).toEqual([0.9, 0.8, 0.7]);
    expect(pipeline[1].$project.embedding).toBe(0);
  });

  it("omits projection when includeVector=true", async () => {
    await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", limit: 1, numCandidates: 5, includeVector: true });
    const pipeline = provider.aggregateCalls[0];
    expect(pipeline.length).toBe(1);
  });

  it("injects filter when provided", async () => {
    await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", limit: 3, numCandidates: 20, filter: { category: "a" } });
    const pipeline = provider.aggregateCalls[0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ category: "a" });
  });

  it("throws when queryText missing", async () => {
    await expect((tool as any).execute({ database: "ai", collection: "docs", limit: 5, numCandidates: 10 }))
      .rejects.toThrow(/'queryText' must be provided/);
  });

  it("throws when path missing in config during execute", async () => {
    buildSessionAndTool({ vectorSearchPath: undefined });
    await expect((tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", limit: 2, numCandidates: 10 }))
      .rejects.toThrow(/requires 'path' argument/);
  });

  it("throws when index missing in config during execute", async () => {
    buildSessionAndTool({ vectorSearchIndex: undefined });
    await expect((tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", limit: 2, numCandidates: 10 }))
      .rejects.toThrow(/requires 'index' argument/);
  });

  it("execute throws on unsupported embedding provider", async () => {
    buildSessionAndTool({ embeddingModelProvider: "some-other-provider" });
    await expect((tool as any).execute({ database: "ai", collection: "docs", queryText: "hi", limit: 2, numCandidates: 10 }))
      .rejects.toThrow(/Unsupported embedding model provider/);
  });
});
