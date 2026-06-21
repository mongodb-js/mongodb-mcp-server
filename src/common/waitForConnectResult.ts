import type { EventEmitter } from "events";
import type { AnyConnectionState, ConnectionManagerEvents } from "./connectionManager.js";

/**
 * Outcome of waiting for an OIDC connection attempt to make progress.
 *
 * - `connected`: authentication completed (e.g. a cached/refreshed token), the
 *   connection is fully established.
 * - `device-flow`: the OIDC plugin reported a device-authorization flow; the
 *   user must visit `oidcLoginUrl` and enter `oidcUserCode` to finish auth.
 * - `errored`: the connection attempt failed.
 * - `timed-out`: nothing terminal happened within the allotted time; the
 *   attempt is still in-flight.
 */
export type WaitForConnectResult =
    | { kind: "connected"; state: AnyConnectionState }
    | { kind: "device-flow"; state: AnyConnectionState; oidcLoginUrl: string; oidcUserCode: string }
    | { kind: "errored"; state: AnyConnectionState }
    | { kind: "timed-out"; state: AnyConnectionState };

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Waits for an in-flight OIDC connection attempt to reach a point where the
 * `connect` tool can report something useful back to the user.
 *
 * For OIDC, {@link ConnectionManager.connect} returns a `connecting` state
 * immediately — before the device-flow callback has populated the verification
 * URL and user code. This helper bridges that gap: it subscribes to the
 * connection manager's events and resolves on the first of:
 *
 *   1. a device-flow notification (`connecting` state carrying `oidcLoginUrl`),
 *   2. a successful connection,
 *   3. an error / time-out, or
 *   4. the local timeout below.
 *
 * It deliberately resolves as soon as the device-flow URL+code are known rather
 * than waiting for `connection-success` — at that point the user has not yet
 * authenticated, so blocking for success would hang until they finish the
 * browser step.
 *
 * Kept free of any MongoDB/transport dependency (it only needs an event emitter
 * and a current-state getter) so it can be unit-tested on any platform with a
 * plain `EventEmitter`.
 */
export function waitForConnectResult({
    events,
    getCurrentState,
    timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
    events: Pick<EventEmitter<ConnectionManagerEvents>, "on" | "off">;
    getCurrentState: () => AnyConnectionState;
    timeoutMs?: number;
}): Promise<WaitForConnectResult> {
    return new Promise<WaitForConnectResult>((resolve) => {
        let settled = false;

        const classify = (state: AnyConnectionState): WaitForConnectResult | undefined => {
            switch (state.tag) {
                case "connected":
                    return { kind: "connected", state };
                case "errored":
                    return { kind: "errored", state };
                case "connecting":
                    if (state.oidcLoginUrl && state.oidcUserCode) {
                        return {
                            kind: "device-flow",
                            state,
                            oidcLoginUrl: state.oidcLoginUrl,
                            oidcUserCode: state.oidcUserCode,
                        };
                    }
                    return undefined;
                default:
                    return undefined;
            }
        };

        const finish = (result: WaitForConnectResult): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            events.off("connection-request", onState);
            events.off("connection-success", onState);
            events.off("connection-error", onState);
            events.off("connection-time-out", onState);
            resolve(result);
        };

        const onState = (state: AnyConnectionState): void => {
            const result = classify(state);
            if (result) {
                finish(result);
            }
        };

        events.on("connection-request", onState);
        events.on("connection-success", onState);
        events.on("connection-error", onState);
        events.on("connection-time-out", onState);

        const timer = setTimeout(() => finish({ kind: "timed-out", state: getCurrentState() }), timeoutMs);
        // Don't let a pending timer keep the process alive.
        timer.unref?.();

        // Re-check the current state immediately after subscribing to close the
        // race where a terminal event fires between the caller's state read and
        // our subscription.
        const current = classify(getCurrentState());
        if (current) {
            finish(current);
        }
    });
}
