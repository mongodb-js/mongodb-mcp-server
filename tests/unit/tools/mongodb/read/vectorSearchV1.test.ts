import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VectorSearchV1Tool } from "../../../../../src/tools/mongodb/read/vectorSearchv1.js";
import { Session } from "../../../../../src/common/session.js";
import EventEmitter from "events";
import { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import { Elicitation } from "../../../../../src/elicitation.js";

// Mock service provider with aggregate support only
class MockServiceProviderV1 {
  public aggregateCalls: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  aggregate(_db: string, _coll: string, pipeline: any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.aggregateCalls.push(pipeline);
    return { toArray: async () => ([{ _id: 1, embedding: [0.1,0.2], title: "Doc" }]) };
  }
}

describe("VectorSearchV1Tool", () => {
  const originalFetch = global.fetch;
  let session: Session;
  let tool: VectorSearchV1Tool;
  let provider: MockServiceProviderV1;

  function buildSessionAndTool(overrides: Record<string, any> = {}) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const connectionEvents = new EventEmitter();
    const connectionManager: any = {
      events: connectionEvents,
      currentConnectionState: { tag: "connected", serviceProvider: undefined, connectedAtlasCluster: undefined },
      setClientName: () => undefined,
      disconnect: async () => undefined,
    };
    provider = new MockServiceProviderV1();
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
      embeddingModelEndpoint: "https://example.test/embeddings",
      embeddingModelApikey: "key",
      embeddingModelDeploymentName: "text-embed",
      embeddingModelDimension: 2,
      telemetry: "disabled",
      // NOTE: For V1 we must NOT set both vectorSearchPath & vectorSearchIndex in config (verifyAllowed would fail)
    } as any;

    const config = { ...baseConfig, ...overrides };
    const telemetry = Telemetry.create(session as any, config, { get: async () => "device-id" } as any);
    const elicitation = new Elicitation({ server: { getClientCapabilities: () => ({}) } as any });
    tool = new VectorSearchV1Tool({ session: session as any, config, telemetry: telemetry as any, elicitation: elicitation as any });
  }

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [0.5, 0.6] }] }) }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    buildSessionAndTool();
  });

  afterEach(() => { global.fetch = originalFetch; });

  it("verifyAllowed returns false if both vectorSearchIndex and vectorSearchPath present in config (disallowed for V1)", () => {
    buildSessionAndTool({ vectorSearchIndex: "idx", vectorSearchPath: "embedding" });
    expect((tool as any).verifyAllowed()).toBe(false);
  });

  it("verifyAllowed returns true with minimal embedding config and without vector index/path overrides", () => {
    buildSessionAndTool();
    expect((tool as any).verifyAllowed()).toBe(true);
  });

  it("embeds queryText and builds expected pipeline", async () => {
    const res = await (tool as any).execute({
      database: "ai", collection: "docs", queryText: "hello", path: "embedding", limit: 3, numCandidates: 50, includeVector: false });
    expect(res).toBeDefined();
    expect(global.fetch).toHaveBeenCalledOnce();
    const pipeline = provider.aggregateCalls[0];
    expect(pipeline[0].$vectorSearch.path).toBe("embedding");
    expect(pipeline[0].$vectorSearch.queryVector).toEqual([0.5, 0.6]);
    expect(pipeline[1].$project.embedding).toBe(0);
  });

  it("includes vector field when includeVector=true", async () => {
    await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", path: "embedding", limit: 1, numCandidates: 5, includeVector: true });
    const pipeline = provider.aggregateCalls[0];
    expect(pipeline.length).toBe(1);
  });

  it("injects filter when provided", async () => {
    await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", path: "embedding", limit: 3, numCandidates: 25, filter: { category: "news" } });
    const pipeline = provider.aggregateCalls[provider.aggregateCalls.length - 1];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ category: "news" });
  });

  it("includes index in stage when index argument supplied", async () => {
    await (tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", path: "embedding", index: "custom_index", limit: 2, numCandidates: 10 });
    const pipeline = provider.aggregateCalls[provider.aggregateCalls.length - 1];
    expect(pipeline[0].$vectorSearch.index).toBe("custom_index");
  });

  it("throws if path missing", async () => {
    await expect((tool as any).execute({ database: "ai", collection: "docs", queryText: "hello", limit: 1, numCandidates: 5 }))
      .rejects.toThrow(/path/);
  });

  it("throws if queryText missing", async () => {
    await expect((tool as any).execute({ database: "ai", collection: "docs", path: "embedding", limit: 2, numCandidates: 10 }))
      .rejects.toThrow(/'queryText' must be provided/);
  });
});
