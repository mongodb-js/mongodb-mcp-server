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

    it("does not match an idle composer", () => {
        expect(isCodexWorking("› Ask Codex to do anything")).toBe(false);
    });

    it("does not match the startup banner", () => {
        expect(isCodexWorking("Waiting for startup  · esc cancel")).toBe(false);
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
});
