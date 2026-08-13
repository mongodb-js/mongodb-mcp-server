import { ObjectId } from "bson";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { LogId, type CompositeLogger, type Keychain } from "@mongodb-js/mcp-core";
import EventEmitter from "events";
import type {
    ConnectionErrorHandler,
    ConnectionRegistry,
    ExportsManager,
} from "@mongodb-js/mcp-tools-mongodb";
import type { Client } from "@mongodb-js/atlas-local";

export interface SessionOptions {
    logger: CompositeLogger;
    exportsManager: ExportsManager;
    connectionRegistry: ConnectionRegistry;
    keychain: Keychain;
    atlasLocalClient?: Client;
    connectionErrorHandler: ConnectionErrorHandler;
    apiClient: ApiClient;
}

export type SessionEvents = {
    close: [];
};

/**
 * Per-MCP-session context: logging, exports, Atlas API access, and secrets.
 *
 * MongoDB connection state is deliberately NOT session-scoped — it lives in the
 * app-level {@link ConnectionRegistry} (shared across sessions) and is addressed
 * by the `connectionId` tool argument. The registry reference here is dependency
 * plumbing, not state.
 */
export class Session extends EventEmitter<SessionEvents> {
    readonly sessionId: string = new ObjectId().toString();
    readonly exportsManager: ExportsManager;
    readonly connectionRegistry: ConnectionRegistry;
    readonly apiClient: ApiClient;
    readonly atlasLocalClient?: Client;
    readonly keychain: Keychain;
    readonly connectionErrorHandler: ConnectionErrorHandler;

    mcpClient?: {
        name?: string;
        version?: string;
        title?: string;
    };

    public readonly logger: CompositeLogger;

    constructor({
        logger,
        connectionRegistry,
        exportsManager,
        keychain,
        atlasLocalClient,
        connectionErrorHandler,
        apiClient,
    }: SessionOptions) {
        super();

        this.keychain = keychain;
        this.logger = logger;
        this.apiClient = apiClient;
        this.atlasLocalClient = atlasLocalClient;
        this.exportsManager = exportsManager;
        this.connectionRegistry = connectionRegistry;
        this.connectionErrorHandler = connectionErrorHandler;
    }

    setMcpClient(mcpClient: Implementation | undefined): void {
        if (!mcpClient) {
            this.logger.debug({
                id: LogId.serverMcpClientSet,
                context: "session",
                message: "MCP client info not found",
            });
        }

        this.mcpClient = {
            name: mcpClient?.name || "unknown",
            version: mcpClient?.version || "unknown",
            title: mcpClient?.title || "unknown",
        };
    }

    async close(): Promise<void> {
        // Close the registry before the API client: revoking
        // Atlas entries deletes their temporary database users through it.
        await this.connectionRegistry.close().catch(() => undefined);
        await this.apiClient?.close();
        await this.exportsManager.close();
        this.emit("close");
    }
}

/**
 * @deprecated Renamed to {@link Session}. Kept as an alias for backwards
 * compatibility.
 */
export const CliSession = Session;
export type CliSession = Session;
export type CliSessionOptions = SessionOptions;
