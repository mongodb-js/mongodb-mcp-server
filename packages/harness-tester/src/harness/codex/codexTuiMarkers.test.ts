import { describe, expect, it } from "vitest";
import { isCodexComposerIdle, isCodexTransitional, isCodexWorking } from "./codexTuiMarkers.js";

describe("isCodexWorking", () => {
    it("matches the default Working header", () => {
        expect(isCodexWorking("• Working (5s • esc to interrupt)")).toBe(true);
    });

    it("matches a reasoning-summary header", () => {
        // The header is replaced with the first reasoning summary line, but the
        // trailing interrupt hint stays the same.
        expect(isCodexWorking("• Listing the databases (2s • esc to interrupt)")).toBe(true);
    });

    it("matches a header containing parentheses", () => {
        expect(isCodexWorking("• Checking the config (v2) (1s • esc to interrupt)")).toBe(true);
    });

    it("matches an animated spinner frame", () => {
        // With animations enabled codex blinks between `•` and `◦`.
        expect(isCodexWorking("◦ Working (3s • esc to interrupt)")).toBe(true);
    });

    it("matches when an inline status message follows the hint", () => {
        expect(isCodexWorking("• Working (3s • esc to interrupt) · Running command")).toBe(true);
    });

    it("does not match commentary that merely ends with the phrase", () => {
        expect(isCodexWorking("• I told it to interrupt)")).toBe(false);
    });

    it("does not match an idle composer", () => {
        expect(isCodexWorking("› Ask Codex to do anything")).toBe(false);
    });

    it("does not match the startup banner", () => {
        expect(isCodexWorking("Waiting for startup  · esc cancel")).toBe(false);
    });

    it("ignores the hint quoted inside an echoed prompt", () => {
        // A complete status line is required; this prompt merely mentions one.
        expect(isCodexWorking("› the status shows • Working (5s • esc to interrupt)")).toBe(false);
    });

    it("still detects the status line when a prompt quotes the hint", () => {
        const viewport = [
            "› the status shows • Working (5s • esc to interrupt)",
            "• Working (2s • esc to interrupt)",
        ].join("\n");
        expect(isCodexWorking(viewport)).toBe(true);
    });
});

describe("isCodexComposerIdle", () => {
    it("matches the idle placeholder", () => {
        expect(isCodexComposerIdle("› Ask Codex to do anything")).toBe(true);
    });

    it("does not match the startup banner", () => {
        expect(isCodexComposerIdle("Waiting for startup  · esc cancel")).toBe(false);
    });
});

describe("isCodexTransitional", () => {
    it("matches the MCP startup banner", () => {
        expect(isCodexTransitional("Waiting for startup  · esc cancel")).toBe(true);
    });

    it("matches a reconnect banner", () => {
        expect(isCodexTransitional("Reconnecting to app-server…")).toBe(true);
    });

    it("does not match a real elicitation", () => {
        expect(isCodexTransitional("Yes, I confirm\nNo, I do not confirm")).toBe(false);
    });

    it("ignores banner text mentioned in a transcript line", () => {
        expect(isCodexTransitional("The log said Waiting for startup and then continued")).toBe(false);
    });
});
