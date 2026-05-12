import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppRegistry } from "./registry.js";

describe("AppRegistry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get()", () => {
        it("should return null for an unknown app", async () => {
            const registry = new AppRegistry({ loaders: {} });

            expect(await registry.get("non-existent-app")).toBeNull();
        });

        it("should return the HTML produced by a loader", async () => {
            const registry = new AppRegistry({
                loaders: {
                    "my-app": async () => "<html>my-app</html>",
                },
            });

            expect(await registry.get("my-app")).toBe("<html>my-app</html>");
        });

        it("should cache results — loader is called only once", async () => {
            const loader = vi.fn().mockResolvedValue("<html>cached</html>");
            const registry = new AppRegistry({ loaders: { "cached-app": loader } });

            const first = await registry.get("cached-app");
            const second = await registry.get("cached-app");

            expect(first).toBe("<html>cached</html>");
            expect(second).toBe("<html>cached</html>");
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it("should return null when the loader throws", async () => {
            const registry = new AppRegistry({
                loaders: {
                    "broken-app": async () => {
                        throw new Error("load failed");
                    },
                },
            });

            expect(await registry.get("broken-app")).toBeNull();
        });

        it("should use custom loaders passed via options", async () => {
            const registry = new AppRegistry({
                loaders: {
                    "custom-app": async () => "<html>custom</html>",
                },
            });

            expect(await registry.get("custom-app")).toBe("<html>custom</html>");
        });
    });

    describe("appNames()", () => {
        it("should return the keys of the loaders", () => {
            const registry = new AppRegistry({
                loaders: {
                    "app-a": async () => "<html>a</html>",
                    "app-b": async () => "<html>b</html>",
                },
            });

            expect(registry.appNames()).toEqual(["app-a", "app-b"]);
        });

        it("should include 'connect-form' when using default loaders", () => {
            const registry = new AppRegistry();

            expect(registry.appNames()).toContain("connect-form");
        });
    });
});
