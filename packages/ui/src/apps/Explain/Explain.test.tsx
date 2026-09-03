import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act, cleanup, fireEvent } from "@testing-library/react";

/**
 * Mock the ext-apps host bridge: captures the handlers the widget registers in
 * `onAppCreated` so tests can deliver tool results / host context manually.
 */
const mocks = vi.hoisted(() => {
    return {
        fakeApp: {
            ontoolresult: undefined as ((params: unknown) => void) | undefined,
            onhostcontextchanged: undefined as ((ctx: { theme?: string }) => void) | undefined,
            getHostContext: (): { theme: string } => ({ theme: mocks.theme }),
        },
        theme: "light",
        error: undefined as Error | undefined,
    };
});

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
    useApp: (options: { onAppCreated?: (app: typeof mocks.fakeApp) => void }): { app: unknown; error?: Error } => {
        options.onAppCreated?.(mocks.fakeApp);
        return { app: mocks.fakeApp, error: mocks.error };
    },
}));

import { Explain } from "./Explain.js";

const classicExplainResult = {
    queryPlanner: {
        namespace: "db.coll",
        parsedQuery: { a: { $eq: 1 } },
        winningPlan: {
            stage: "FETCH",
            inputStage: { stage: "IXSCAN", indexName: "a_1", keyPattern: { a: 1 } },
        },
    },
    executionStats: {
        executionSuccess: true,
        nReturned: 3,
        executionTimeMillis: 5,
        totalKeysExamined: 3,
        totalDocsExamined: 3,
        executionStages: {
            stage: "FETCH",
            nReturned: 3,
            executionTimeMillisEstimate: 5,
            docsExamined: 3,
            inputStage: {
                stage: "IXSCAN",
                indexName: "a_1",
                keyPattern: { a: 1 },
                isMultiKey: false,
                nReturned: 3,
                executionTimeMillisEstimate: 2,
                keysExamined: 3,
                docsExamined: 3,
            },
        },
    },
    ok: 1,
};

const plannerOnlyExplainResult = {
    queryPlanner: {
        namespace: "db.coll",
        parsedQuery: {},
        winningPlan: { stage: "COLLSCAN", direction: "forward" },
    },
    ok: 1,
};

function sendToolResult(explainResult: unknown, verbosity: string): void {
    act(() => {
        mocks.fakeApp.ontoolresult?.({
            content: [{ type: "text", text: "explain output" }],
            structuredContent: { explainResult, method: "find", verbosity },
        });
    });
}

describe("Explain", () => {
    beforeEach(() => {
        mocks.theme = "light";
        mocks.error = undefined;
        mocks.fakeApp.ontoolresult = undefined;
        mocks.fakeApp.onhostcontextchanged = undefined;
    });

    afterEach(() => {
        cleanup();
    });

    it("shows a waiting state before a tool result arrives", () => {
        render(<Explain />);
        expect(screen.getByTestId("explain-waiting")).toBeInTheDocument();
    });

    it("shows an error when the host connection fails", () => {
        mocks.error = new Error("boom");
        render(<Explain />);
        expect(screen.getByRole("alert")).toHaveTextContent("boom");
    });

    it("renders the plan tree and summary for executionStats results", async () => {
        render(<Explain />);

        sendToolResult(classicExplainResult, "executionStats");

        await waitFor(() => {
            expect(screen.getByTestId("explain-tree")).toBeInTheDocument();
        });

        // stage cards
        expect(screen.getByText("FETCH")).toBeInTheDocument();
        expect(screen.getByText("IXSCAN")).toBeInTheDocument();

        // summary bar
        const summary = screen.getByTestId("explain-summary");
        expect(summary).toHaveTextContent("db.coll");
        expect(summary).toHaveTextContent("executionStats");

        // index highlight on the IXSCAN card
        expect(screen.getByText("Index Name:")).toBeInTheDocument();
        expect(screen.getByText("a_1")).toBeInTheDocument();
    });

    it("shows the planner-only fallback for queryPlanner results", async () => {
        render(<Explain />);

        sendToolResult(plannerOnlyExplainResult, "queryPlanner");

        await waitFor(() => {
            expect(screen.getByTestId("explain-planner-outline")).toBeInTheDocument();
        });
        expect(screen.getByText(/Re-run explain with/)).toBeInTheDocument();
        // winning plan outline lists the stage
        expect(screen.getByTestId("explain-planner-outline")).toHaveTextContent("COLLSCAN");
        expect(screen.queryByTestId("explain-tree")).not.toBeInTheDocument();
    });

    it("toggles between visual tree and raw output views", async () => {
        render(<Explain />);

        sendToolResult(classicExplainResult, "executionStats");

        await waitFor(() => {
            expect(screen.getByTestId("explain-tree")).toBeInTheDocument();
        });

        // visual tree is the default selected segment
        expect(screen.getByRole("button", { name: /Visual Tree/ })).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByRole("button", { name: /Raw Output/ }));

        await waitFor(() => {
            expect(screen.getByTestId("explain-raw-view")).toBeInTheDocument();
        });
        expect(screen.queryByTestId("explain-tree")).not.toBeInTheDocument();
        expect(screen.getByTestId("explain-raw-view")).toHaveTextContent('"FETCH"');

        fireEvent.click(screen.getByRole("button", { name: /Visual Tree/ }));
        await waitFor(() => {
            expect(screen.getByTestId("explain-tree")).toBeInTheDocument();
        });
    });

    it("applies the dark theme from the host context", async () => {
        mocks.theme = "dark";
        render(<Explain />);

        await waitFor(() => {
            // Via tokens express colors as rgb() strings
            expect(screen.getByTestId("explain-app")).toHaveStyle({ backgroundColor: "rgb(0, 30, 43)" });
        });
    });

    it("reacts to host theme changes", async () => {
        render(<Explain />);

        await waitFor(() => {
            expect(screen.getByTestId("explain-app")).toHaveStyle({ backgroundColor: "rgb(255, 255, 255)" });
        });

        act(() => {
            mocks.fakeApp.onhostcontextchanged?.({ theme: "dark" });
        });

        await waitFor(() => {
            expect(screen.getByTestId("explain-app")).toHaveStyle({ backgroundColor: "rgb(0, 30, 43)" });
        });
    });
});
