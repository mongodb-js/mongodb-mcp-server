import { describe, it, expect } from "vitest";
import { getBumpFromCommit, maxBump, parseArgs } from "../../../scripts/bumpPackages.js";

describe("getBumpFromCommit", () => {
    it("returns major for breaking change with bang", () => {
        expect(getBumpFromCommit("feat!: remove deprecated API")).toBe("major");
        expect(getBumpFromCommit("fix!: change return type")).toBe("major");
        expect(getBumpFromCommit("refactor(core)!: restructure modules")).toBe("major");
    });

    it("returns major for BREAKING CHANGE in subject", () => {
        expect(getBumpFromCommit("feat: something BREAKING CHANGE")).toBe("major");
    });

    it("returns minor for feat commits", () => {
        expect(getBumpFromCommit("feat: add new tool")).toBe("minor");
        expect(getBumpFromCommit("feat(atlas): support new region")).toBe("minor");
    });

    it("returns patch for fix commits", () => {
        expect(getBumpFromCommit("fix: handle null response")).toBe("patch");
        expect(getBumpFromCommit("fix(metrics): correct counter")).toBe("patch");
    });

    it("returns patch for other conventional commit types", () => {
        expect(getBumpFromCommit("chore: update deps")).toBe("patch");
        expect(getBumpFromCommit("docs: update README")).toBe("patch");
        expect(getBumpFromCommit("refactor: simplify logic")).toBe("patch");
        expect(getBumpFromCommit("test: add missing tests")).toBe("patch");
        expect(getBumpFromCommit("ci: fix workflow")).toBe("patch");
        expect(getBumpFromCommit("perf: optimize query")).toBe("patch");
        expect(getBumpFromCommit("build: update tsconfig")).toBe("patch");
        expect(getBumpFromCommit("style: fix formatting")).toBe("patch");
    });

    it("returns patch for non-conventional commits", () => {
        expect(getBumpFromCommit("update something")).toBe("patch");
        expect(getBumpFromCommit("WIP")).toBe("patch");
        expect(getBumpFromCommit("Merge branch 'main'")).toBe("patch");
    });
});

describe("maxBump", () => {
    it("returns null when both are null", () => {
        expect(maxBump(null, null)).toBeNull();
    });

    it("returns the non-null value", () => {
        expect(maxBump("patch", null)).toBe("patch");
        expect(maxBump(null, "minor")).toBe("minor");
    });

    it("returns the higher bump", () => {
        expect(maxBump("patch", "minor")).toBe("minor");
        expect(maxBump("minor", "patch")).toBe("minor");
        expect(maxBump("minor", "major")).toBe("major");
        expect(maxBump("major", "minor")).toBe("major");
        expect(maxBump("patch", "major")).toBe("major");
    });

    it("returns either when equal", () => {
        expect(maxBump("patch", "patch")).toBe("patch");
        expect(maxBump("minor", "minor")).toBe("minor");
        expect(maxBump("major", "major")).toBe("major");
    });
});

describe("parseArgs", () => {
    it("returns defaults with no args", () => {
        expect(parseArgs([])).toEqual({ filters: [], overrides: [] });
    });

    it("parses a single --filter", () => {
        expect(parseArgs(["--filter", "."])).toEqual({ filters: ["."], overrides: [] });
    });

    it("parses multiple --filter flags", () => {
        expect(parseArgs(["--filter", ".", "--filter", "@mongodb-js/mcp-metrics"])).toEqual({
            filters: [".", "@mongodb-js/mcp-metrics"],
            overrides: [],
        });
    });

    it("parses --override with release type", () => {
        const result = parseArgs(["--override", "mongodb-mcp-server:patch"]);
        expect(result.overrides).toEqual([{ name: "mongodb-mcp-server", version: "patch" }]);
    });

    it("parses --override with exact version", () => {
        const result = parseArgs(["--override", "mongodb-mcp-server:1.2.3"]);
        expect(result.overrides).toEqual([{ name: "mongodb-mcp-server", version: "1.2.3" }]);
    });

    it("parses --override with scoped package name", () => {
        const result = parseArgs(["--override", "@mongodb-js/mcp-metrics:minor"]);
        expect(result.overrides).toEqual([{ name: "@mongodb-js/mcp-metrics", version: "minor" }]);
    });

    it("parses --override with prerelease version", () => {
        const result = parseArgs(["--override", "mongodb-mcp-server:1.2.3-beta.1"]);
        expect(result.overrides).toEqual([{ name: "mongodb-mcp-server", version: "1.2.3-beta.1" }]);
    });

    it("parses multiple --override flags", () => {
        const result = parseArgs([
            "--override",
            "mongodb-mcp-server:patch",
            "--override",
            "@mongodb-js/mcp-metrics:minor",
        ]);
        expect(result.overrides).toEqual([
            { name: "mongodb-mcp-server", version: "patch" },
            { name: "@mongodb-js/mcp-metrics", version: "minor" },
        ]);
    });

    it("parses --filter and --override together", () => {
        const result = parseArgs(["--filter", ".", "--override", "mongodb-mcp-server:minor"]);
        expect(result.filters).toEqual(["."]);
        expect(result.overrides).toEqual([{ name: "mongodb-mcp-server", version: "minor" }]);
    });

    it("ignores unknown flags", () => {
        expect(parseArgs(["--unknown", "value"])).toEqual({ filters: [], overrides: [] });
    });

    it("ignores --filter or --override without a following value", () => {
        expect(parseArgs(["--filter"]).filters).toEqual([]);
        expect(parseArgs(["--override"]).overrides).toEqual([]);
    });

    it("throws on --override with no colon separator", () => {
        expect(() => parseArgs(["--override", "invalid"])).toThrow();
    });
});
