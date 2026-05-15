import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { DocumentBrowser } from "./DocumentBrowser.js";
import type { App } from "@modelcontextprotocol/ext-apps/react";

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
    useApp: vi.fn(),
    useHostStyles: vi.fn(),
}));

import { useApp } from "@modelcontextprotocol/ext-apps/react";
const mockUseApp = vi.mocked(useApp);

const INITIAL_RENDER_DATA_KEY = "mcpui.dev/ui-initial-render-data";

function makeApp(
    hostContext: Record<string, unknown> | null = null,
    callServerToolImpl?: () => Promise<unknown>
): Partial<App> {
    return {
        getHostContext: vi.fn().mockReturnValue(hostContext),
        onhostcontextchanged: null,
        callServerTool: vi.fn().mockImplementation(callServerToolImpl ?? (() => new Promise(() => {}))),
    };
}

/** Renders DocumentBrowser and captures the onAppCreated callback so tests can trigger ontoolinput. */
function renderWithOnAppCreated(
    appOverride: Partial<App> = makeApp(),
    isConnected = true
): { triggerToolInput: (args: unknown) => void } {
    let capturedOnAppCreated: ((app: App) => void) | undefined;

    mockUseApp.mockImplementation(({ onAppCreated }) => {
        capturedOnAppCreated = onAppCreated;
        return { app: appOverride as App, isConnected, error: null };
    });

    render(<DocumentBrowser />);

    return {
        triggerToolInput: (args: unknown) => {
            capturedOnAppCreated?.(appOverride as App);
            (appOverride as { ontoolinput?: (p: { arguments: unknown }) => void }).ontoolinput?.({
                arguments: args,
            });
        },
    };
}

function makeFindRenderData(): Record<string, unknown> {
    return {
        [INITIAL_RENDER_DATA_KEY]: {
            database: "mydb",
            collection: "mycoll",
            query: { find: { filter: { status: "active" }, limit: 10 } },
        },
    };
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("DocumentBrowser — ontoolinput path (standard, e.g. MCP Inspector)", () => {
    it("shows 'Connecting…' before connected", () => {
        mockUseApp.mockReturnValue({ app: makeApp() as App, isConnected: false, error: null });
        render(<DocumentBrowser />);
        expect(screen.getByText("Connecting…")).toBeInTheDocument();
    });

    it("shows 'No query parameters provided.' when connected but no tool input received", () => {
        mockUseApp.mockReturnValue({ app: makeApp({}) as App, isConnected: true, error: null });
        render(<DocumentBrowser />);
        expect(screen.getByText("No query parameters provided.")).toBeInTheDocument();
    });

    it("renders collection and find params after ontoolinput fires", async () => {
        const { triggerToolInput } = renderWithOnAppCreated();

        await act(async () => {
            triggerToolInput({ database: "mydb", collection: "mycoll", query: { find: { filter: {} } } });
        });

        expect(screen.getByText("mydb.mycoll")).toBeInTheDocument();
        expect(screen.getByText("Find")).toBeInTheDocument();
    });

    it("renders pipeline params after ontoolinput fires with aggregate query", async () => {
        const { triggerToolInput } = renderWithOnAppCreated();

        await act(async () => {
            triggerToolInput({
                database: "mydb",
                collection: "mycoll",
                query: { aggregate: { pipeline: [{ $match: { active: true } }] } },
            });
        });

        expect(screen.getByText("Pipeline")).toBeInTheDocument();
    });

    it("shows invalid-params error when ontoolinput carries an unrecognised query shape", async () => {
        const { triggerToolInput } = renderWithOnAppCreated();

        await act(async () => {
            triggerToolInput({ database: "db", collection: "coll", query: { bad: true } });
        });

        expect(screen.getByText(/Invalid query parameters/)).toBeInTheDocument();
    });

    it("calls find tool and shows results after ontoolinput", async () => {
        const mockResult = {
            isError: false,
            content: [{ type: "text", text: '[{"_id":"1"}]' }],
        };
        const app = makeApp(null, () => Promise.resolve(mockResult));
        const { triggerToolInput } = renderWithOnAppCreated(app);

        await act(async () => {
            triggerToolInput({ database: "mydb", collection: "mycoll", query: { find: { filter: {}, limit: 5 } } });
            await Promise.resolve();
        });

        expect(app.callServerTool).toHaveBeenCalledWith({
            name: "find",
            arguments: { database: "mydb", collection: "mycoll", filter: {}, limit: 5 },
        });
        expect(screen.getByText('[{"_id":"1"}]')).toBeInTheDocument();
    });
});

describe("DocumentBrowser — initial-render-data fallback (e.g. Claude.ai)", () => {
    it("renders collection and find params from host context initial-render-data", () => {
        mockUseApp.mockReturnValue({
            app: makeApp(makeFindRenderData()) as App,
            isConnected: true,
            error: null,
        });

        render(<DocumentBrowser />);

        expect(screen.getByText("mydb.mycoll")).toBeInTheDocument();
        expect(screen.getByText("Find")).toBeInTheDocument();
    });

    it("calls find tool on mount via initial-render-data", async () => {
        const mockResult = { isError: false, content: [{ type: "text", text: "[]" }] };
        const app = makeApp(makeFindRenderData(), () => Promise.resolve(mockResult));
        mockUseApp.mockReturnValue({ app: app as App, isConnected: true, error: null });

        render(<DocumentBrowser />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(app.callServerTool).toHaveBeenCalled();
    });
});

describe("DocumentBrowser — host error", () => {
    it("shows host error message when useApp returns an error", () => {
        mockUseApp.mockReturnValue({
            app: null,
            isConnected: false,
            error: new Error("host unavailable"),
        });

        render(<DocumentBrowser />);

        expect(screen.getByText(/Failed to connect to MCP host: host unavailable/)).toBeInTheDocument();
    });
});
