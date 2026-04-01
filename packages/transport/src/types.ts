import type { DefaultMetrics as MonitoringDefaultMetrics } from "@mongodb-mcp/monitoring";
import type { LoggerBase } from "@mongodb-mcp/logging";

export type DefaultMetrics = MonitoringDefaultMetrics;

export type { LoggerBase } from "@mongodb-mcp/logging";

/**
 * Device ID interface for telemetry and identification.
 */
export interface DeviceId {
    id: string;
    type: string;
}

/**
 * Request context for HTTP-based transports.
 */
export interface RequestContext {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
}

/**
 * Minimal server interface that the transport layer needs
 * to connect and manage MCP servers.
 */
export interface MCPServer {
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
    session: {
        logger: LoggerBase;
    };
}
