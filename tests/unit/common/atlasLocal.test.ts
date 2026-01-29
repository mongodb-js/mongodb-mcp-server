import { describe, expect, it, vi } from "vitest";
import { defaultCreateAtlasLocalClient, type LibraryLoader } from "../../../src/common/atlasLocal.js";
import type { Client } from "@mongodb-js/atlas-local";
import { NullLogger } from "../../utils/index.js";

describe("Atlas Local", () => {
    describe("defaultCreateAtlasLocalClient", () => {
        it("should return undefined when the library cannot be loaded", async () => {
            const failingLoader: LibraryLoader = {
                loadAtlasLocalClient(): Promise<typeof Client | undefined> {
                    return Promise.resolve(undefined);
                },
            };
            const result = await defaultCreateAtlasLocalClient({ loader: failingLoader, logger: new NullLogger() });
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

            const result = await defaultCreateAtlasLocalClient({ loader: succeedingLoader, logger: new NullLogger() });
            expect(result).toBe("fake client");
        });
    });
});
