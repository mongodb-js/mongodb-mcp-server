import { describe, it, expect } from "vitest";
import { escapeMarkdown } from "../../../src/helpers/escapeMarkdown.js";

describe("escapeMarkdown", () => {
    it("leaves plain alphanumeric text untouched", () => {
        expect(escapeMarkdown("readWrite on admin")).toBe("readWrite on admin");
    });

    it("returns an empty string unchanged", () => {
        expect(escapeMarkdown("")).toBe("");
    });

    it.each([
        ["*", "\\*"],
        ["_", "\\_"],
        ["`", "\\`"],
        ["\\", "\\\\"],
        ["[", "\\["],
        ["]", "\\]"],
        ["(", "\\("],
        [")", "\\)"],
        ["{", "\\{"],
        ["}", "\\}"],
        ["<", "\\<"],
        [">", "\\>"],
        ["#", "\\#"],
        ["+", "\\+"],
        ["-", "\\-"],
        [".", "\\."],
        ["!", "\\!"],
        ["|", "\\|"],
    ])("escapes the metacharacter %j", (input, expected) => {
        expect(escapeMarkdown(input)).toBe(expected);
    });

    it("escapes every metacharacter in a mixed string", () => {
        expect(escapeMarkdown("atlasAdmin`<!--")).toBe("atlasAdmin\\`\\<\\!\\-\\-");
    });

    it("neutralizes an HTML comment used to hide content", () => {
        const escaped = escapeMarkdown("db<!--hidden-->");
        expect(escaped).not.toContain("<!--");
        expect(escaped).toBe("db\\<\\!\\-\\-hidden\\-\\-\\>");
    });

    it("escapes markdown emphasis so it cannot restyle text", () => {
        expect(escapeMarkdown("**bold**")).toBe("\\*\\*bold\\*\\*");
    });
});
