import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup, within } from "@testing-library/react";
import { ListDatabases } from "../../../../../src/ui/components/ListDatabases/ListDatabases.js";

/**
 * Helper to simulate the parent window sending render data via postMessage
 */
function sendRenderData(data: unknown): void {
    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                type: "ui-lifecycle-iframe-render-data",
                payload: {
                    renderData: data,
                },
            },
        })
    );
}

describe("ListDatabases", () => {
    afterEach(() => {
        cleanup();
    });

    it("should show loading state initially", () => {
        render(<ListDatabases />);

        expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("should render table with database data", async () => {
        render(<ListDatabases />);

        act(() => {
            sendRenderData({
                databases: [
                    { name: "admin", size: 1024 },
                    { name: "local", size: 2048 },
                ],
                totalCount: 2,
            });
        });

        await waitFor(() => {
            expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
        });

        const table = screen.getByTestId("lg-table");
        expect(table).toBeInTheDocument();
        expect(within(table).getByText("admin")).toBeInTheDocument();
        expect(within(table).getByText("local")).toBeInTheDocument();
        expect(within(table).getByText("1 KB")).toBeInTheDocument();
        expect(within(table).getByText("2 KB")).toBeInTheDocument();
    });

    it("should render empty table with no databases", async () => {
        render(<ListDatabases />);

        act(() => {
            sendRenderData({
                databases: [],
                totalCount: 0,
            });
        });

        await waitFor(() => {
            expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
        });

        const table = screen.getByTestId("lg-table");
        expect(table).toBeInTheDocument();
        expect(within(table).queryAllByTestId("lg-table-row")).toHaveLength(0);
    });

    it("should format bytes correctly for various sizes", async () => {
        render(<ListDatabases />);

        act(() => {
            sendRenderData({
                databases: [
                    { name: "tiny", size: 0 },
                    { name: "small", size: 512 },
                    { name: "medium", size: 1048576 }, // 1 MB
                    { name: "large", size: 1073741824 }, // 1 GB
                ],
                totalCount: 4,
            });
        });

        await waitFor(() => {
            expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
        });

        const table = screen.getByTestId("lg-table");
        expect(within(table).getByText("0 Bytes")).toBeInTheDocument();
        expect(within(table).getByText("512 Bytes")).toBeInTheDocument();
        expect(within(table).getByText("1 MB")).toBeInTheDocument();
        expect(within(table).getByText("1 GB")).toBeInTheDocument();
    });

    it("should show error when data loading fails", async () => {
        render(<ListDatabases />);

        act(() => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        type: "ui-lifecycle-iframe-render-data",
                        payload: "invalid-payload",
                    },
                })
            );
        });

        await waitFor(() => {
            expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
        });

        expect(screen.getByText(/Error:/)).toBeInTheDocument();
    });

    it("should return null for invalid data structure", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const { container } = render(<ListDatabases />);

        act(() => {
            sendRenderData({
                // Missing required fields
                invalidField: "test",
            });
        });

        await waitFor(() => {
            // Component should render null after validation fails
            expect(container.firstChild).toBeNull();
        });

        consoleSpy.mockRestore();
    });
});
