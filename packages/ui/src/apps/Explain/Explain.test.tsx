import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act, cleanup, fireEvent, within } from "@testing-library/react";

/**
 * Mock the ext-apps host bridge: captures the handlers the widget registers in
 * `onAppCreated` so tests can deliver tool results / host context manually.
 */
interface ExplainMocks {
    fakeApp: {
        ontoolresult: ((params: unknown) => void) | undefined;
        ontoolcancelled: (() => void) | undefined;
        onhostcontextchanged: ((ctx: { theme?: string }) => void) | undefined;
        getHostContext: () => { theme?: string };
    };
    /** `undefined` models a host that provides no theme in its context. */
    theme: string | undefined;
    error: Error | undefined;
}

const mocks = vi.hoisted(
    (): ExplainMocks => ({
        fakeApp: {
            ontoolresult: undefined,
            ontoolcancelled: undefined,
            onhostcontextchanged: undefined,
            getHostContext: (): { theme?: string } => (mocks.theme ? { theme: mocks.theme } : {}),
        },
        theme: "light",
        error: undefined,
    })
);

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
    useApp: (options: { onAppCreated?: (app: typeof mocks.fakeApp) => void }): { app: unknown; error?: Error } => {
        options.onAppCreated?.(mocks.fakeApp);
        return { app: mocks.fakeApp, error: mocks.error };
    },
    // Host style variables are applied to the document by the real hook; the
    // theme's var() references are asserted directly in theme.test.ts.
    useHostStyles: (): void => undefined,
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
        mocks.fakeApp.ontoolcancelled = undefined;
        mocks.fakeApp.onhostcontextchanged = undefined;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        cleanup();
    });

    it("falls back to the OS colour scheme when the host provides no theme", async () => {
        mocks.theme = undefined;
        vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
        render(<Explain />);

        await waitFor(() => {
            expect(screen.getByTestId("explain-app")).toHaveAttribute("data-theme", "dark");
        });
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

        // stage cards (scoped to the visual tree; the sr-only text outline
        // contains the same stage names)
        const tree = within(screen.getByTestId("explain-tree"));
        expect(tree.getByText("FETCH")).toBeInTheDocument();
        expect(tree.getByText("IXSCAN")).toBeInTheDocument();

        // summary bar
        const summary = screen.getByTestId("explain-summary");
        expect(summary).toHaveTextContent("db.coll");
        expect(summary).toHaveTextContent("executionStats");

        // index highlight on the IXSCAN card
        expect(screen.getByText("Index Name:")).toBeInTheDocument();
        expect(screen.getByText("a_1")).toBeInTheDocument();
    });

    it("exposes the tree's parent/child structure as a text outline", async () => {
        render(<Explain />);

        sendToolResult(classicExplainResult, "executionStats");

        await waitFor(() => {
            expect(screen.getByTestId("explain-tree")).toBeInTheDocument();
        });

        const outline = screen.getByRole("group", { name: "Explain plan tree (text outline)" });
        const items = within(outline).getAllByRole("listitem");
        expect(items).toHaveLength(2);
        // nesting: the IXSCAN item is a descendant of the FETCH item (the
        // hierarchy the absolutely-positioned cards cannot convey)
        expect(items[0]).toHaveTextContent("FETCH");
        expect(items[0]).toHaveTextContent("IXSCAN");
        expect(items[1]).toHaveTextContent("IXSCAN");
        expect(items[1]).not.toHaveTextContent("FETCH");
    });

    it("marks the stage card's expanded state and keeps the details outside its button", async () => {
        render(<Explain />);

        sendToolResult(classicExplainResult, "executionStats");

        const card = await screen.findByRole("button", { name: /FETCH/ });
        expect(card).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(card);

        await waitFor(() => {
            expect(screen.getByTestId("explain-stage-details")).toBeInTheDocument();
        });
        const expandedCard = screen.getByRole("button", { name: /FETCH/ });
        expect(expandedCard).toHaveAttribute("aria-expanded", "true");
        // the JSON pane is not part of the button's accessible name
        expect(expandedCard.contains(screen.getByTestId("explain-stage-details"))).toBe(false);
    });

    it("raises the focused stage card above a sibling's open details pane", async () => {
        render(<Explain />);

        sendToolResult(classicExplainResult, "executionStats");

        // open the FETCH card's details pane, which extends over the cards below
        fireEvent.click(await screen.findByRole("button", { name: /FETCH/ }));
        await waitFor(() => {
            expect(screen.getByTestId("explain-stage-details")).toBeInTheDocument();
        });

        const ixscanCard = screen.getByRole("button", { name: /IXSCAN/ });
        fireEvent.focusIn(ixscanCard);
        await waitFor(() => {
            // wrapper > card > button; the wrapper carries the stacking order
            expect(ixscanCard.parentElement?.parentElement).toHaveStyle({ zIndex: "3" });
        });
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
            // Colour values are CSS variables with Via fallbacks (asserted in
            // theme.test.ts); the selected theme is observable here.
            expect(screen.getByTestId("explain-app")).toHaveAttribute("data-theme", "dark");
        });
    });

    it("shows an error panel when the tool reports a failure", async () => {
        render(<Explain />);

        act(() => {
            mocks.fakeApp.ontoolresult?.({
                content: [{ type: "text", text: "boom: collection does not exist" }],
                isError: true,
            });
        });

        await waitFor(() => {
            expect(screen.getByRole("alert")).toHaveTextContent("boom: collection does not exist");
        });
        expect(screen.getByRole("alert")).toHaveTextContent(/Explain failed/);
        expect(screen.queryByTestId("explain-waiting")).not.toBeInTheDocument();
    });

    it("shows an error panel (not the tree) when isError accompanies structured content", async () => {
        render(<Explain />);

        act(() => {
            mocks.fakeApp.ontoolresult?.({
                content: [{ type: "text", text: "execution failed" }],
                isError: true,
                structuredContent: { explainResult: classicExplainResult, method: "find", verbosity: "executionStats" },
            });
        });

        await waitFor(() => {
            expect(screen.getByRole("alert")).toHaveTextContent("execution failed");
        });
        expect(screen.queryByTestId("explain-tree")).not.toBeInTheDocument();
        // the raw result is still inspectable
        expect(screen.getByTestId("explain-raw-output")).toBeInTheDocument();
    });

    it("shows a cancelled state when the host cancels the tool call", async () => {
        render(<Explain />);

        act(() => {
            mocks.fakeApp.ontoolcancelled?.();
        });

        await waitFor(() => {
            expect(screen.getByRole("alert")).toHaveTextContent(/Explain was cancelled/);
        });
        expect(screen.queryByTestId("explain-waiting")).not.toBeInTheDocument();
    });

    it("reacts to host theme changes", async () => {
        render(<Explain />);

        await waitFor(() => {
            expect(screen.getByTestId("explain-app")).toHaveAttribute("data-theme", "light");
        });

        act(() => {
            mocks.fakeApp.onhostcontextchanged?.({ theme: "dark" });
        });

        await waitFor(() => {
            expect(screen.getByTestId("explain-app")).toHaveAttribute("data-theme", "dark");
        });
    });
});
