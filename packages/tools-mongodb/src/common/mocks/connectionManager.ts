import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import {
    ConnectionManager,
    ConnectionStateConnected,
    type AnyConnectionState,
    type ConnectionSettings,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
} from "../../../src/common/connectionManager.js";

/**
 * A ConnectionManager stub for unit tests that need registry entries in
 * deterministic states without dialing a real MongoDB instance. Successful
 * connects transition to a connected state exposing `serviceProvider` (or a
 * `{ fake: true }` placeholder); setting `failNextConnect` makes the next
 * connect transition to an errored state and throw, mirroring
 * MCPConnectionManager's behavior on a failed dial.
 */
export class FakeConnectionManager extends ConnectionManager {
    public connectCalls: ConnectionSettings[] = [];
    public failNextConnect?: Error;
    public closed = false;

    constructor(private serviceProvider?: NodeDriverServiceProvider) {
        super();
    }

    override connect(settings: ConnectionSettings): Promise<AnyConnectionState> {
        this.connectCalls.push(settings);
        if (this.failNextConnect) {
            const error = this.failNextConnect;
            this.failNextConnect = undefined;
            this.changeState("connection-error", { tag: "errored", errorReason: error.message });
            return Promise.reject(error);
        }
        return Promise.resolve(
            this.changeState(
                "connection-success",
                new ConnectionStateConnected(
                    this.serviceProvider ?? ({ fake: true } as unknown as NodeDriverServiceProvider),
                    { authType: "scram", hostType: "unknown" },
                    settings.atlas
                )
            )
        );
    }

    override disconnect(): Promise<ConnectionStateDisconnected | ConnectionStateErrored> {
        return Promise.resolve(this.changeState("connection-close", { tag: "disconnected" as const }));
    }

    override async close(): Promise<void> {
        this.closed = true;
        await this.disconnect();
    }
}
