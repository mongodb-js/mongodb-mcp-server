import { EventEmitter } from "events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForConnectResult } from "../../../src/common/waitForConnectResult.js";
import type {
    AnyConnectionState,
    ConnectionManagerEvents,
    ConnectionStateConnecting,
} from "../../../src/common/connectionManager.js";

/**
 * Minimal harness mimicking the connection manager's event bus + current-state
 * getter, so we can exercise `waitForConnectResult` without a real MongoDB
 * connection (the real OIDC path is Linux-only and skipped on other platforms).
 */
function makeHarness(initial: AnyConnectionState): {
    events: EventEmitter<ConnectionManagerEvents>;
    getCurrentState: () => AnyConnectionState;
    changeState: (event: keyof ConnectionManagerEvents, state: AnyConnectionState) => void;
} {
    const events = new EventEmitter<ConnectionManagerEvents>();
    let state = initial;
    const emit = events.emit.bind(events) as (
        event: keyof ConnectionManagerEvents,
        payload: AnyConnectionState
    ) => void;
    return {
        events,
        getCurrentState: (): AnyConnectionState => state,
        changeState: (event: keyof ConnectionManagerEvents, next: AnyConnectionState): void => {
            state = next;
            emit(event, next);
        },
    };
}

const connectingState: ConnectionStateConnecting = {
    tag: "connecting",
    serviceProvider: Promise.resolve() as unknown as ConnectionStateConnecting["serviceProvider"],
    oidcConnectionType: "oidc-auth-flow",
    connectionStringInfo: { authType: "oidc-auth-flow", hostType: "unknown" },
};

describe("waitForConnectResult", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves with the device-flow URL and code when the OIDC plugin notifies", async () => {
        const harness = makeHarness(connectingState);

        const pending = waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
        });

        harness.changeState("connection-request", {
            ...connectingState,
            oidcLoginUrl: "https://idp.example/device",
            oidcUserCode: "ABCD-EFGH",
        });

        const result = await pending;
        expect(result).toMatchObject({
            kind: "device-flow",
            oidcLoginUrl: "https://idp.example/device",
            oidcUserCode: "ABCD-EFGH",
        });
        expect(result.state.tag).toBe("connecting");
    });

    it("resolves as connected when authentication succeeds without a device flow", async () => {
        const harness = makeHarness(connectingState);

        const pending = waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
        });

        const connected = { tag: "connected" } as unknown as AnyConnectionState;
        harness.changeState("connection-success", connected);

        const result = await pending;
        expect(result.kind).toBe("connected");
    });

    it("resolves as errored when the connection attempt fails", async () => {
        const harness = makeHarness(connectingState);

        const pending = waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
        });

        harness.changeState("connection-error", {
            tag: "errored",
            errorReason: "boom",
        } as AnyConnectionState);

        const result = await pending;
        expect(result.kind).toBe("errored");
    });

    it("times out when nothing terminal happens", async () => {
        const harness = makeHarness(connectingState);

        const pending = waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
            timeoutMs: 5_000,
        });

        await vi.advanceTimersByTimeAsync(5_000);

        const result = await pending;
        expect(result.kind).toBe("timed-out");
    });

    it("short-circuits on an already-terminal current state (subscribe race)", async () => {
        const harness = makeHarness({
            ...connectingState,
            oidcLoginUrl: "https://idp.example/device",
            oidcUserCode: "WXYZ-1234",
        });

        const result = await waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
        });

        expect(result).toMatchObject({ kind: "device-flow", oidcUserCode: "WXYZ-1234" });
    });

    it("ignores intermediate connecting states without a URL yet", async () => {
        const harness = makeHarness(connectingState);

        const pending = waitForConnectResult({
            events: harness.events,
            getCurrentState: harness.getCurrentState,
        });

        // A connecting event with no URL yet should not resolve the promise.
        harness.changeState("connection-request", connectingState);
        harness.changeState("connection-request", {
            ...connectingState,
            oidcLoginUrl: "https://idp.example/device",
            oidcUserCode: "LATE-CODE",
        });

        const result = await pending;
        expect(result).toMatchObject({ kind: "device-flow", oidcUserCode: "LATE-CODE" });
    });
});
