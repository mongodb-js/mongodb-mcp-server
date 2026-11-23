import { describe, expect, it } from "vitest";
import { buildCodexTuiArgs } from "./codexHarness.js";

describe("buildCodexTuiArgs", () => {
    it("disables the shared background server when supported", () => {
        expect(
            buildCodexTuiArgs("Options:\n      --no-daemon\n          Run without the shared background server")
        ).toEqual(["--no-daemon"]);
    });

    it("keeps older CLIs without the no-daemon option supported", () => {
        expect(
            buildCodexTuiArgs("Commands:\n  agents  Browse sessions on the shared daemon\nOptions:\n  --help")
        ).toEqual([]);
    });

    it("does not mistake another option for no-daemon support", () => {
        expect(buildCodexTuiArgs("Options:\n  --no-daemon-other")).toEqual([]);
    });
});
