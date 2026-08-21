import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { HttpTransportWithSessionRecovery } from "./httpTransportWithSessionRecovery.js";

const INITIALIZE_MESSAGE: JSONRPCMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
    },
};

const TOOL_LIST_MESSAGE: JSONRPCMessage = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
};

const TOOL_CALL_MESSAGE: JSONRPCMessage = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
};

type MockHttpTransport = {
    sessionId?: string;
    onmessage?: (message: JSONRPCMessage) => void;
    start: Mock<() => Promise<void>>;
    close: Mock<() => Promise<void>>;
    send: Mock<(message: JSONRPCMessage) => Promise<void>>;
};

const SESSION_EXPIRED_ERROR = new SdkError(SdkErrorCode.ClientHttpNotImplemented, "Test error", {
    status: 404,
    text: "Not Found",
});

const INITIALIZED_NOTIFICATION: JSONRPCMessage = { jsonrpc: "2.0", method: "notifications/initialized" };

function createMockTransport(): MockHttpTransport {
    return {
        sessionId: "test-session-id",
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
    };
}

describe("HttpTransportWithSessionRecovery", () => {
    let transportWrapper: HttpTransportWithSessionRecovery | undefined;
    let underlyingTransports: MockHttpTransport[];
    let onmessage: Mock<(message: JSONRPCMessage) => void>;

    beforeEach(() => {
        underlyingTransports = [];
        onmessage = vi.fn();
        transportWrapper = new HttpTransportWithSessionRecovery(() => {
            const mock = createMockTransport();
            underlyingTransports.push(mock);
            return mock;
        }, onmessage);
    });

    afterEach(() => {
        vi.clearAllMocks();
        transportWrapper = undefined;
        underlyingTransports = [];
    });

    it("forwards start, send, and close to the underlying transport", async () => {
        await transportWrapper!.start();
        expect(underlyingTransports[0].start).toHaveBeenCalledTimes(1);
        await transportWrapper!.send(TOOL_LIST_MESSAGE);
        expect(underlyingTransports[0].send).toHaveBeenCalledWith(TOOL_LIST_MESSAGE);
        await transportWrapper!.close();
        expect(underlyingTransports[0].close).toHaveBeenCalledTimes(1);
        expect(underlyingTransports).toHaveLength(1);
    });

    it("re-initializes and retries when the session expired", async () => {
        await transportWrapper!.send(INITIALIZE_MESSAGE);
        underlyingTransports[0].send.mockRejectedValue(SESSION_EXPIRED_ERROR);
        await transportWrapper!.send(TOOL_LIST_MESSAGE);

        expect(underlyingTransports).toHaveLength(2);
        expect(underlyingTransports[0].close).toHaveBeenCalledTimes(1);
        expect(underlyingTransports[1].start).toHaveBeenCalledTimes(1);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(INITIALIZE_MESSAGE);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(INITIALIZED_NOTIFICATION);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(TOOL_LIST_MESSAGE);
    });

    it("does not forward the response to the replayed initialize message during recovery, but forwards others", async () => {
        await transportWrapper!.send(INITIALIZE_MESSAGE);
        const initializeResult: JSONRPCMessage = { jsonrpc: "2.0", id: INITIALIZE_MESSAGE.id, result: {} };

        // First initialize result is forwarded.
        underlyingTransports[0].onmessage!(initializeResult);
        expect(onmessage).toHaveBeenCalledWith(initializeResult);
        onmessage.mockClear();

        underlyingTransports[0].send.mockRejectedValue(SESSION_EXPIRED_ERROR);
        await transportWrapper!.send(TOOL_LIST_MESSAGE);

        // Re-initialize result is swallowed.
        underlyingTransports[1].onmessage!(initializeResult);
        expect(onmessage).not.toHaveBeenCalledWith(initializeResult);

        // Other messages are forwarded.
        const toolListResult: JSONRPCMessage = { jsonrpc: "2.0", id: TOOL_LIST_MESSAGE.id, result: {} };
        underlyingTransports[1].onmessage!(toolListResult);
        expect(onmessage).toHaveBeenCalledWith(toolListResult);
    });

    it("does not recover from non-session-expired errors", async () => {
        const otherError = new SdkError(SdkErrorCode.ClientHttpForbidden, "Forbidden", { status: 403 });
        underlyingTransports[0].send.mockRejectedValue(otherError);

        await expect(transportWrapper!.send(TOOL_LIST_MESSAGE)).rejects.toBe(otherError);
        expect(underlyingTransports).toHaveLength(1);
        expect(underlyingTransports[0].close).not.toHaveBeenCalled();
    });

    it("throws when session expires and there is no cached initialize message", async () => {
        underlyingTransports[0].send.mockRejectedValue(SESSION_EXPIRED_ERROR);

        await expect(transportWrapper!.send(TOOL_LIST_MESSAGE)).rejects.toThrow(
            "Cannot re-initialize session: no cached initialize message"
        );
    });

    it("concurrent requests share a single re-initialization", async () => {
        await transportWrapper!.send(INITIALIZE_MESSAGE);
        underlyingTransports[0].send.mockRejectedValue(SESSION_EXPIRED_ERROR);

        await Promise.all([transportWrapper!.send(TOOL_LIST_MESSAGE), transportWrapper!.send(TOOL_CALL_MESSAGE)]);

        expect(underlyingTransports).toHaveLength(2);
        expect(underlyingTransports[0].close).toHaveBeenCalledTimes(1);
        expect(underlyingTransports[1].start).toHaveBeenCalledTimes(1);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(INITIALIZE_MESSAGE);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(INITIALIZED_NOTIFICATION);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(TOOL_LIST_MESSAGE);
        expect(underlyingTransports[1].send).toHaveBeenCalledWith(TOOL_CALL_MESSAGE);
    });
});
