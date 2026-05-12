import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectForm } from "./ConnectForm.js";

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
    useApp: vi.fn(),
}));

import { useApp } from "@modelcontextprotocol/ext-apps/react";
const mockUseApp = vi.mocked(useApp);

function makeApp(callServerTool: ReturnType<typeof vi.fn> = vi.fn()) {
    return { callServerTool };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("ConnectForm", () => {
    it("should render heading, pre-filled input, and Connect button", () => {
        mockUseApp.mockReturnValue({ app: makeApp(), isConnected: true, error: null });

        render(<ConnectForm />);

        expect(screen.getByText("Connect to MongoDB")).toBeInTheDocument();
        expect(screen.getByLabelText("Connection String")).toHaveValue("mongodb://localhost:27017");
        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    });

    it("should disable input and button when not connected", () => {
        mockUseApp.mockReturnValue({ app: makeApp(), isConnected: false, error: null });

        render(<ConnectForm />);

        expect(screen.getByLabelText("Connection String")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    });

    it("should show host error message when useApp returns an error", () => {
        mockUseApp.mockReturnValue({
            app: null,
            isConnected: false,
            error: new Error("host unavailable"),
        });

        render(<ConnectForm />);

        expect(screen.getByText(/Failed to connect to MCP host: host unavailable/)).toBeInTheDocument();
    });

    it("should show success state after a successful callServerTool", async () => {
        const callServerTool = vi.fn().mockResolvedValue({ isError: false, content: [] });
        mockUseApp.mockReturnValue({ app: makeApp(callServerTool), isConnected: true, error: null });

        render(<ConnectForm />);

        await userEvent.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => {
            expect(screen.getByText("Connected successfully!")).toBeInTheDocument();
        });

        expect(screen.queryByRole("form")).not.toBeInTheDocument();
    });

    it("should show error text when callServerTool returns isError: true", async () => {
        const callServerTool = vi.fn().mockResolvedValue({
            isError: true,
            content: [{ type: "text", text: "auth failed" }],
        });
        mockUseApp.mockReturnValue({ app: makeApp(callServerTool), isConnected: true, error: null });

        render(<ConnectForm />);

        await userEvent.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => {
            expect(screen.getByText("auth failed")).toBeInTheDocument();
        });

        expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    });

    it("should show error text when callServerTool throws", async () => {
        const callServerTool = vi.fn().mockRejectedValue(new Error("network error"));
        mockUseApp.mockReturnValue({ app: makeApp(callServerTool), isConnected: true, error: null });

        render(<ConnectForm />);

        await userEvent.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => {
            expect(screen.getByText("network error")).toBeInTheDocument();
        });
    });

    it("should show 'Connecting…' and disable controls while in flight", async () => {
        let resolve!: (v: unknown) => void;
        const deferred = new Promise((res) => (resolve = res));
        const callServerTool = vi.fn().mockReturnValue(deferred);
        mockUseApp.mockReturnValue({ app: makeApp(callServerTool), isConnected: true, error: null });

        render(<ConnectForm />);

        await userEvent.click(screen.getByRole("button", { name: "Connect" }));

        await waitFor(() => {
            expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
        });
        expect(screen.getByLabelText("Connection String")).toBeDisabled();

        // Resolve the promise so the component settles before cleanup
        await act(async () => {
            resolve({ isError: false, content: [] });
        });
    });
});
