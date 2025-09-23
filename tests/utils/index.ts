import { type ConnectionManagerEvents } from "../../src/common/connectionManager.js";
import { LoggerBase, type LoggerType } from "../../src/common/logger.js";
import { type ConnectionManager } from "../../src/lib.js";

export class NullLogger extends LoggerBase {
    protected type?: LoggerType;

    constructor() {
        super(undefined);
    }

    protected logCore(): void {
        // No-op logger, does not log anything
    }
}
/**
 * For a few tests, we need the changeState method to force a connection state
 * which is we have this type to typecast the actual ConnectionManager with
 * public changeState (only to make TS happy).
 */
export type TestConnectionManager = ConnectionManager & {
    changeState<Event extends keyof ConnectionManagerEvents, State extends ConnectionManagerEvents[Event][0]>(
        event: Event,
        newState: State
    ): State;
};
