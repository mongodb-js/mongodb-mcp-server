import { ObjectId } from "bson";
import type { ApiClient } from "./atlas/apiClient.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { CompositeLogger } from "./logging/index.js";
import { LogId } from "./logging/index.js";
import EventEmitter from "events";
import type { ExportsManager } from "./exportsManager.js";
import type { Client } from "@mongodb-js/atlas-local";
import type { Keychain } from "./keychain.js";
import { type ConnectionErrorHandler } from "./connectionErrorHandler.js";
import type { ConnectionRegistry } from "./connectionRegistry.js";

export interface SessionOptions {
    logger: CompositeLogger;
    exportsManager: ExportsManager;
    connectionRegistry: ConnectionRegistry;
    keychain: Keychain;
    atlasLocalClient?: Client;
    connectionErrorHandler: ConnectionErrorHandler;
    apiClient: ApiClient;
    /**
     * When true, `close()` closes every connection reachable through
     * `connectionRegistry`. Transports set this for registries whose handles
     * become unreachable once the session is gone (session-scoped views and
     * per-session stores).
     */
    ownsConnectionRegistry?: boolean;
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
 * plumbing, not state. See `docs/proposals/2026-07-14-connection-handles.md`.
 */
export class Session extends EventEmitter<SessionEvents> {
    readonly sessionId: string = new ObjectId().toString();
    readonly exportsManager: ExportsManager;
    readonly connectionRegistry: ConnectionRegistry;
    readonly apiClient: ApiClient;
    readonly atlasLocalClient?: Client;
    readonly keychain: Keychain;
    readonly connectionErrorHandler: ConnectionErrorHandler;
    private readonly ownsConnectionRegistry: boolean;

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
        ownsConnectionRegistry,
    }: SessionOptions) {
        super();

        this.keychain = keychain;
        this.logger = logger;
        this.apiClient = apiClient;
        this.atlasLocalClient = atlasLocalClient;
        this.exportsManager = exportsManager;
        this.connectionRegistry = connectionRegistry;
        this.connectionErrorHandler = connectionErrorHandler;
        this.ownsConnectionRegistry = ownsConnectionRegistry ?? false;
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
        if (this.ownsConnectionRegistry) {
            // Connections close before the API client: revoking Atlas entries
            // deletes their temporary database users through it.
            await this.connectionRegistry.closeAll().catch(() => undefined);
        }
        await this.apiClient?.close();
        await this.exportsManager.close();
        this.emit("close");
    }
}
