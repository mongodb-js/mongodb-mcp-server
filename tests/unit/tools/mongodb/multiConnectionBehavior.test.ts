/**
 * Focused unit tests for the per-call `connection` argument added by the
 * multi-connection feature (src/common/connectionRegistry.ts +
 * src/tools/mongodb/mongodbTool.ts).
 *
 * These tests exercise the real production wiring (MongoDBToolBase.invoke,
 * Session, MCPConnectionManager, ConnectionRegistry) end to end. The only
 * seam that is mocked is the deepest driver call,
 * `NodeDriverServiceProvider.connect`, exactly like
 * `tests/unit/common/session.test.ts` already does — so no real MongoDB
 * process or network access is required.
 *
 * Proves:
 *  (a) Backward compat — a single MDB_MCP_CONNECTION_STRING (config.connectionString)
 *      still works when a tool call carries no `connection` argument.
 *  (b) A per-call `connection` argument selects the named connection from the
 *      registry, without ever touching the session-default connection.
 *  (c) Two different `connection` values in interleaved (overlapping)
 *      concurrent calls do not cross state — each call observes only its own
 *      requested connection's provider, regardless of resolution order.
 */
import type { Mocked } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoDBToolBase } from "../../../../src/tools/mongodb/mongodbTool.js";
import type { OperationType, ToolArgs, ToolCategory, ToolExecutionContext } from "../../../../src/tools/tool.js";
import type { TelemetryToolMetadata } from "../../../../src/telemetry/types.js";
import type { UserConfig } from "../../../../src/common/config/userConfig.js";
import { MCPConnectionManager } from "../../../../src/common/connectionManager.js";
import { ConnectionRegistry, resolveDefaultConnectionName } from "../../../../src/common/connectionRegistry.js";
import { Session } from "../../../../src/common/session.js";
import { CompositeLogger } from "../../../../src/common/logging/index.js";
import { DeviceId } from "../../../../src/helpers/deviceId.js";
import { ExportsManager } from "../../../../src/common/exportsManager.js";
import { Keychain } from "../../../../src/common/keychain.js";
import { connectionErrorHandler } from "../../../../src/common/connectionErrorHandler.js";
import { defaultCreateApiClient } from "../../../../src/lib.js";
import { defaultTestConfig } from "../../../integration/helpers.js";
import { MockMetrics } from "../../mocks/metrics.js";

vi.mock("@mongosh/service-provider-node-driver");

const MockNodeDriverServiceProvider = vi.mocked(NodeDriverServiceProvider);

/** A fake connected provider, tagged with the connection string it was "opened" against. */
interface FakeProvider {
    _tag: string;
    close: () => Promise<void>;
}

function makeFakeProvider(tag: string): FakeProvider {
    return { _tag: tag, close: vi.fn().mockResolvedValue(undefined) };
}

/** Resolves a deferred promise from outside its executor. */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/**
 * Minimal MongoDBToolBase implementation used purely to drive `ensureConnected()`
 * (and, through it, the `connection` argument resolution) via the real
 * `invoke()` override in MongoDBToolBase. The tool reports back which
 * provider it ended up talking to via the fake provider's `_tag`.
 */
class ProbeTool extends MongoDBToolBase {
    static toolName = "probe-tool";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "read";
    public description = "Reports which connection it resolved to.";
    public argsShape = {
        connection: z.string().optional().describe("Name of a pre-configured connection to use for this call."),
    };

    protected async execute(): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const tag = (provider as unknown as FakeProvider)._tag;
        return { content: [{ type: "text", text: tag }] };
    }

    protected resolveTelemetryMetadata(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _extra: { result: CallToolResult }
    ): TelemetryToolMetadata {
        return {};
    }
}

function resultText(result: CallToolResult): string {
    const first = result.content[0];
    if (!first || first.type !== "text") {
        throw new Error(`Expected a text content block, got: ${JSON.stringify(result)}`);
    }
    return first.text;
}

function newContext(): ToolExecutionContext {
    return { signal: new AbortController().signal };
}

describe("MongoDBToolBase multi-connection behavior (connection argument)", () => {
    let mockDeviceId: Mocked<DeviceId>;
    let logger: CompositeLogger;

    beforeEach(() => {
        vi.clearAllMocks();
        logger = new CompositeLogger();
        mockDeviceId = vi.mocked(DeviceId.create(logger));
        mockDeviceId.get = vi.fn().mockResolvedValue("test-device-id");
    });

    /** Builds a real Session (real ConnectionManager + real ConnectionRegistry) for the given config. */
    function buildSession(config: UserConfig): Session {
        const connectionManager = new MCPConnectionManager(config, logger, mockDeviceId);
        const connectionRegistry = new ConnectionRegistry({
            userConfig: config,
            deviceId: mockDeviceId,
            logger,
            getClientName: () => connectionManager.clientName,
            connections: config.connections,
            defaultConnectionName: resolveDefaultConnectionName(config),
        });

        return new Session({
            userConfig: config,
            logger,
            exportsManager: ExportsManager.init(config, logger),
            connectionManager,
            connectionRegistry,
            keychain: new Keychain(),
            apiClient: defaultCreateApiClient(
                { baseUrl: config.apiBaseUrl, credentials: undefined },
                logger
            ),
            connectionErrorHandler,
        });
    }

    function buildProbeTool(session: Session, config: UserConfig): ProbeTool {
        return new ProbeTool({
            name: ProbeTool.toolName,
            category: ProbeTool.category,
            operationType: ProbeTool.operationType,
            session,
            config,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as never,
            elicitation: { requestConfirmation: vi.fn() } as never,
            metrics: new MockMetrics(),
        });
    }

    it("(a) backward compat: a single connectionString still works with no 'connection' arg", async () => {
        MockNodeDriverServiceProvider.connect = vi
            .fn()
            .mockImplementation((connectionString: string) => Promise.resolve(makeFakeProvider("legacy")));

        const config: UserConfig = {
            ...defaultTestConfig,
            connectionString: "mongodb://legacy-host/db",
        };
        const session = buildSession(config);
        const tool = buildProbeTool(session, config);

        const result = await tool.invoke({} as ToolArgs<typeof tool.argsShape>, newContext());

        expect(result.isError).toBeFalsy();
        expect(resultText(result)).toBe("legacy");

        // The legacy connection string was used to establish the session-default connection.
        expect(MockNodeDriverServiceProvider.connect).toHaveBeenCalledTimes(1);
        const usedConnectionString = MockNodeDriverServiceProvider.connect.mock.calls[0]?.[0];
        expect(usedConnectionString).toContain("legacy-host");

        // The registry never had (and never gained) any named entries — this really is
        // the legacy single-connection path, not the registry.
        expect(session.connectionRegistry.names()).toEqual([]);
        expect(session.isConnectedToMongoDB).toBe(true);
    });

    it("(b) a per-call 'connection' arg selects the named connection without touching the session default", async () => {
        MockNodeDriverServiceProvider.connect = vi.fn().mockImplementation((connectionString: string) => {
            if (connectionString.includes("analytics-host")) {
                return Promise.resolve(makeFakeProvider("analytics"));
            }
            if (connectionString.includes("legacy-host")) {
                return Promise.resolve(makeFakeProvider("legacy"));
            }
            return Promise.reject(new Error(`unexpected connection string: ${connectionString}`));
        });

        const config: UserConfig = {
            ...defaultTestConfig,
            // A legacy default IS configured, to prove it is not the one used.
            connectionString: "mongodb://legacy-host/db",
            connections: {
                analytics: { connectionString: "mongodb://analytics-host/db" },
            },
        };
        const session = buildSession(config);
        const tool = buildProbeTool(session, config);

        const result = await tool.invoke(
            { connection: "analytics" } as ToolArgs<typeof tool.argsShape>,
            newContext()
        );

        expect(result.isError).toBeFalsy();
        expect(resultText(result)).toBe("analytics");

        // Only the named connection was dialed — the legacy default was never connected.
        expect(MockNodeDriverServiceProvider.connect).toHaveBeenCalledTimes(1);
        const usedConnectionString = MockNodeDriverServiceProvider.connect.mock.calls[0]?.[0];
        expect(usedConnectionString).toContain("analytics-host");

        expect(session.connectionRegistry.statusOf("analytics")).toBe("connected");
        // The session-default connection manager was never engaged.
        expect(session.isConnectedToMongoDB).toBe(false);
    });

    it("(c) two different 'connection' values in interleaved calls do not cross state", async () => {
        const alphaGate = createDeferred<void>();
        const betaGate = createDeferred<void>();
        const connectOrder: string[] = [];

        MockNodeDriverServiceProvider.connect = vi.fn().mockImplementation(async (connectionString: string) => {
            if (connectionString.includes("alpha-host")) {
                connectOrder.push("alpha-start");
                await alphaGate.promise;
                connectOrder.push("alpha-end");
                return makeFakeProvider("alpha");
            }
            if (connectionString.includes("beta-host")) {
                connectOrder.push("beta-start");
                await betaGate.promise;
                connectOrder.push("beta-end");
                return makeFakeProvider("beta");
            }
            throw new Error(`unexpected connection string: ${connectionString}`);
        });

        const config: UserConfig = {
            ...defaultTestConfig,
            // No legacy connectionString at all: both calls must go through named connections.
            connections: {
                alpha: { connectionString: "mongodb://alpha-host/db" },
                beta: { connectionString: "mongodb://beta-host/db" },
            },
        };
        const session = buildSession(config);
        const tool = buildProbeTool(session, config);

        // Kick off BOTH calls without awaiting - they both pause inside the
        // mocked `connect()`, holding two independent AsyncLocalStorage
        // contexts (one per `invoke()` call) simultaneously in flight.
        const callAlpha = tool.invoke({ connection: "alpha" } as ToolArgs<typeof tool.argsShape>, newContext());
        const callBeta = tool.invoke({ connection: "beta" } as ToolArgs<typeof tool.argsShape>, newContext());

        // Let both reach their gate before releasing either.
        await vi.waitFor(() => {
            expect(connectOrder).toContain("alpha-start");
            expect(connectOrder).toContain("beta-start");
        });

        // Resolve BETA first even though ALPHA was requested first - if the
        // per-call connection name ever leaked through shared/instance state
        // instead of staying scoped to its own call via AsyncLocalStorage,
        // finishing beta before alpha would surface the wrong tag on one of them.
        betaGate.resolve();
        const betaResult = await callBeta;
        alphaGate.resolve();
        const alphaResult = await callAlpha;

        expect(resultText(betaResult)).toBe("beta");
        expect(resultText(alphaResult)).toBe("alpha");

        // Confirms genuine interleaving happened (beta finished while alpha was still pending).
        expect(connectOrder).toEqual(["alpha-start", "beta-start", "beta-end", "alpha-end"]);

        expect(MockNodeDriverServiceProvider.connect).toHaveBeenCalledTimes(2);
        expect(session.connectionRegistry.statusOf("alpha")).toBe("connected");
        expect(session.connectionRegistry.statusOf("beta")).toBe("connected");
        // Neither call touched the session-default slot.
        expect(session.isConnectedToMongoDB).toBe(false);
    });
});
