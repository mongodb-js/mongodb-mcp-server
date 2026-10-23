import { describe, expect, it } from "vitest";
import { NoopExportsManager } from "./noopExportsManager.js";

describe("NoopExportsManager", () => {
    it("rejects rather than reporting an export it cannot produce", async () => {
        const exportsManager = new NoopExportsManager();

        await expect(
            exportsManager.createJSONExport({
                input: {} as never,
                exportName: "export",
                exportTitle: "My export",
                jsonExportFormat: "relaxed",
            })
        ).rejects.toThrow('Exporting "My export" is not supported.');
    });
});
