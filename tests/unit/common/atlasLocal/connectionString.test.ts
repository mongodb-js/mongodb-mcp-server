import { describe, expect, it, vi } from "vitest";
import type { Client } from "@mongodb-js/atlas-local";
import { waitForConnectionString } from "../../../../src/common/atlasLocal/connectionString.js";

describe("waitForConnectionString", () => {
    it("returns immediately when port bindings are already available", async () => {
        const client = {
            getConnectionString: vi.fn().mockResolvedValue("mongodb://localhost:27017"),
        };

        await expect(waitForConnectionString(client as unknown as Client, "local1")).resolves.toBe(
            "mongodb://localhost:27017"
        );
        expect(client.getConnectionString).toHaveBeenCalledTimes(1);
    });

    it("retries when port bindings are not yet published", async () => {
        const client = {
            getConnectionString: vi
                .fn()
                .mockRejectedValueOnce(
                    new Error("get connection string\n\nCaused by:\n    Missing port binding information")
                )
                .mockRejectedValueOnce(
                    new Error("get connection string\n\nCaused by:\n    Missing port binding information")
                )
                .mockResolvedValue("mongodb://localhost:27017"),
        };

        await expect(
            waitForConnectionString(client as unknown as Client, "local1", { maxAttempts: 5, intervalMs: 1 })
        ).resolves.toBe("mongodb://localhost:27017");
        expect(client.getConnectionString).toHaveBeenCalledTimes(3);
    });

    it("rethrows non-port-binding errors without retrying", async () => {
        const client = {
            getConnectionString: vi.fn().mockRejectedValue(new Error("No such container: local1")),
        };

        await expect(
            waitForConnectionString(client as unknown as Client, "local1", { maxAttempts: 3, intervalMs: 1 })
        ).rejects.toThrow("No such container: local1");
        expect(client.getConnectionString).toHaveBeenCalledTimes(1);
    });

    it("retries up to maxAttempts then throws the last port-binding error", async () => {
        const maxAttempts = 3;
        const client = {
            getConnectionString: vi
                .fn()
                .mockRejectedValue(
                    new Error("get connection string\n\nCaused by:\n    Missing port binding information")
                ),
        };

        await expect(
            waitForConnectionString(client as unknown as Client, "local1", { maxAttempts, intervalMs: 1 })
        ).rejects.toThrow("Missing port binding information");
        expect(client.getConnectionString).toHaveBeenCalledTimes(maxAttempts);
    });
});
