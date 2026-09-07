export type { StreamableHttpRunnerOptions } from "./streamableHttpRunner.js";

// Node.js-specific transport runners
export { StreamableHttpRunner } from "./streamableHttpRunner.js";

// HTTP Servers
export { MCPHttpServer, type MCPHttpServerOptions } from "./mcpHttpServer.js";
export { LegacyMcpHttpHandler, type LegacyMcpHttpHandlerOptions } from "./legacyMcpHttpHandler.js";
// Session lifecycle primitives now live in @mongodb-js/mcp-core; re-export for convenience.
export {
    LegacySessionStore,
    SessionLimitExceededError,
    SessionRejectedError,
    DEFAULT_MAX_SESSIONS,
    DEFAULT_EVICTION_IDLE_GRACE_MS,
    type LegacySessionOptions,
    type LegacySessionStoreConstructorArgs,
    type SessionCloseReason,
    type SessionCloseHandler,
} from "@mongodb-js/mcp-core";
export { MonitoringServer, type MonitoringServerOptions } from "./monitoringServer.js";

// Express HTTP Server base
export { ExpressBasedHttpServer, type ExpressBasedHttpServerOptions } from "./expressBasedHttpServer.js";
