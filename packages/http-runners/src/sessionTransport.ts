import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

/**
 * The transport the legacy (2025-era) HTTP path serves sessions through. Re-exported so consumers
 * do not import `@modelcontextprotocol/node` themselves: it publishes separate `.d.mts`/`.d.cts`
 * types, and a direct import can resolve the one this package does not.
 */
export type SessionTransport = NodeStreamableHTTPServerTransport;
