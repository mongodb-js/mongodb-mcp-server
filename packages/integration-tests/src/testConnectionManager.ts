import type { ConnectionManager, ConnectionManagerEvents } from "@mongodb-js/mcp-tools-mongodb";

/**
 * For a few tests, we need the changeState method to force a connection state
 * which is why we have this type to typecast the actual ConnectionManager with
 * public changeState (only to make TS happy).
 */
export type TestConnectionManager = ConnectionManager & {
    changeState<Event extends keyof ConnectionManagerEvents, State extends ConnectionManagerEvents[Event][0]>(
        event: Event,
        newState: State
    ): State;
};
