import { describe, expect, it } from "vitest";
import { ExplainAppHtml } from "../lib/apps/explain.js";
import { ListDatabasesHtml } from "../lib/tools/list-databases.js";

/**
 * Regression guard for the "superset bundle" bug: the former shared mount used
 * an eager `import.meta.glob` registry, which defeated tree-shaking and pulled
 * every widget — plus the mcp-ui/LeafyGreen dependency graph and the
 * @testing-library code that rides in through it — into every generated HTML.
 * Each bundle must carry only its own dependency graph.
 */
describe("generated UI bundles", () => {
    it("the Explain app bundle carries only its own dependency graph", () => {
        expect(ExplainAppHtml).not.toContain("testing-library");
        expect(ExplainAppHtml).not.toContain("leafygreen");
    });

    it("the mcp-ui ListDatabases bundle does not carry the Explain app", () => {
        expect(ListDatabasesHtml).not.toContain("mongodb-mcp-explain");
    });
});
