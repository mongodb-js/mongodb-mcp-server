import { describe, expect, it, vi } from "vitest";
import { createAtlasLocalClient, type LibraryLoader } from "@mongodb-js/mcp-tools-atlas-local";
import type { Client } from "@mongodb-js/atlas-local";
import { NoopLogger } from "@mongodb-js/mcp-core";

describe("Atlas Local", () => {
    describe("createAtlasLocalClient", () => {
        it("should return undefined when the library cannot be loaded", async () => {
            const failingLoader: LibraryLoader = {
                loadAtlasLocalClient(): Promise<typeof Client | undefined> {
                    return Promise.resolve(undefined);
                },
            };
            const result = await createAtlasLocalClient({ loader: failingLoader, logger: new NoopLogger() });
            expect(result).toBeUndefined();
        });

        it("should load the library on supported platforms", async () => {
            const succeedingLoader: LibraryLoader = {
                loadAtlasLocalClient(): Promise<typeof Client | undefined> {
                    const MockClient = class {
                        static connect = vi.fn(() => "fake client");

                        constructor() {}
                    } as unknown as typeof Client;

                    return Promise.resolve(MockClient);
                },
            };

            const result = await createAtlasLocalClient({ loader: succeedingLoader, logger: new NoopLogger() });
            expect(result).toBe("fake client");
        });
    });
});
