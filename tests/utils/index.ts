import { beforeEach, afterEach } from "vitest";
import { type ConnectionManagerEvents } from "../../src/common/connectionManager.js";
import { type ConnectionManager } from "../../src/lib.js";

export function createEnvironment(): {
    setVariable: (this: void, variable: string, value: unknown) => void;
    clearVariables(this: void): void;
} {
    const registeredEnvVariables: string[] = [];

    return {
        setVariable(variable: string, value: unknown): void {
            (process.env as Record<string, unknown>)[variable] = value;
            registeredEnvVariables.push(variable);
        },

        clearVariables(): void {
            for (const variable of registeredEnvVariables) {
                delete (process.env as Record<string, unknown>)[variable];
            }
        },
    };
}

/** Clears environment variables that start with the given prefix.
 *  Creates a clean environment for the test by saving the original values of the variables and restoring them after the test.
 */
export function useClearEnvironment(prefix: string): void {
    let saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        saved = Object.create(null);
        for (const key of Object.keys(process.env)) {
            if (key.startsWith(prefix)) {
                saved[key] = process.env[key];
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        Object.assign(process.env, saved);
    });
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
