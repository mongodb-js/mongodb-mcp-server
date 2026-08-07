// Microbenchmark: retained heap per MCP "session" (tool registry).
// Run: node --expose-gc tmp/bench-session-memory.mjs [N]
// Replicates Server.registerTools(): for each tool ctor, `new ctor(params)`
// then `tool.register({mcpServer})`, into a fresh per-session McpServer.

import { AllTools } from "../dist/esm/tools/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const N = Number(process.argv[2] ?? 192);
const MiB = (b) => (b / 1024 / 1024).toFixed(1);

// Match the remote server: atlas + mongodb tools only.
const TOOL_CTORS = AllTools.filter((t) => t.category === "atlas" || t.category === "mongodb");

const noop = () => {};
const logger = { debug: noop, info: noop, warning: noop, error: noop, notice: noop, log: noop };
const config = {
    readOnly: false,
    disabledTools: [],
    transport: "http",
    httpBodyLimit: undefined,
    connectionString: undefined,
    apiClientId: "n/a",
    apiClientSecret: "n/a",
};
const params = (ctor) => ({
    name: ctor.toolName,
    category: ctor.category,
    operationType: ctor.operationType,
    session: { logger },
    config,
    telemetry: {},
    elicitation: {},
    metrics: {},
    uiRegistry: undefined,
    context: undefined,
});

function newMcpServer() {
    return new McpServer({ name: "bench", version: "1.0.0" });
}

// Instantiate + register the full registry into a fresh McpServer (one "session").
function buildFullSession() {
    const mcpServer = newMcpServer();
    const server = { mcpServer };
    const tools = [];
    let ok = 0;
    for (const ctor of TOOL_CTORS) {
        const tool = new ctor(params(ctor));
        if (tool.register(server)) ok++;
        tools.push(tool);
    }
    return { mcpServer, tools, ok };
}

// Register a single shared set of tool instances into a fresh McpServer.
// Simulates sharing tool instances/schemas across sessions: per session we
// only pay for the McpServer + its _registeredTools schema wrappers.
let SHARED_TOOLS;
function buildSharedRegSession() {
    if (!SHARED_TOOLS) SHARED_TOOLS = TOOL_CTORS.map((ctor) => new ctor(params(ctor)));
    const mcpServer = newMcpServer();
    const server = { mcpServer };
    for (const tool of SHARED_TOOLS) tool.register(server);
    return mcpServer;
}

// Instantiate tools only (no McpServer, no register) to isolate instance cost.
function buildInstancesOnly() {
    const tools = [];
    for (const ctor of TOOL_CTORS) tools.push(new ctor(params(ctor)));
    return tools;
}

async function settle() {
    global.gc();
    await new Promise((r) => setTimeout(r, 50));
    global.gc();
}

async function measure(label, factory) {
    await settle();
    const before = process.memoryUsage();
    const retained = [];
    for (let i = 0; i < N; i++) retained.push(factory());
    await settle();
    const after = process.memoryUsage();
    const dHeap = after.heapUsed - before.heapUsed;
    const dRss = after.rss - before.rss;
    console.log(
        `${label.padEnd(22)} | heapUsed +${MiB(dHeap)} MiB (${MiB(dHeap / N)}/session)` +
            ` | rss +${MiB(dRss)} MiB (${MiB(dRss / N)}/session)`
    );
    // Touch retained so it isn't optimized away before measurement.
    return retained.length;
}

async function main() {
    if (!global.gc) {
        console.error("Run with: node --expose-gc tmp/bench-session-memory.mjs");
        process.exit(1);
    }
    // Warm up: realize module-level shared schema constants + JIT before measuring.
    const warm = buildFullSession();
    console.log(`Tools per session: attempted=${TOOL_CTORS.length} registered=${warm.ok}`);
    console.log(`Sessions (N): ${N}`);
    console.log(`node ${process.version}\n`);

    await measure("full (instantiate+reg)", buildFullSession);
    await measure("shared instances+reg", buildSharedRegSession);
    await measure("instances only", () => buildInstancesOnly());
    await measure("empty McpServer only", () => newMcpServer());
}

void main();
