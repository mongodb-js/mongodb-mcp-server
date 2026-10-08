import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { ExportedData } from "./exportedData.js";
import type { CliServer } from "@mongodb-js/mcp-cli";

/**
 * A minimal CliServer surface that ExportedData reads off the host. The
 * exportsManager must be a real EventEmitter so listener counts are tracked.
 */
function makeServer(): { server: CliServer; exportsManager: EventEmitter } {
    const exportsManager = new EventEmitter();
    const server = {
        mcpServer: { registerResource: vi.fn() },
        exportsManager,
        sendResourceListChanged: vi.fn(),
        sendResourceUpdated: vi.fn(),
    } as unknown as CliServer;
    return { server, exportsManager };
}

describe("ExportedData resource", () => {
    it("registers export listeners on the shared exportsManager for long-lived transports (stdio)", () => {
        const { server, exportsManager } = makeServer();
        new ExportedData({ server }).register(server);

        expect(exportsManager.listenerCount("export-available")).toBe(1);
        expect(exportsManager.listenerCount("export-expired")).toBe(1);
    });

    it("does not register export listeners for transport-scoped servers (HTTP)", () => {
        const { server, exportsManager } = makeServer();
        new ExportedData({ server, transportRequest: { headers: {} } }).register(server);

        expect(exportsManager.listenerCount("export-available")).toBe(0);
        expect(exportsManager.listenerCount("export-expired")).toBe(0);
    });
});
