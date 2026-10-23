/**
 * Codex TUI markers.
 *
 * The status indicator's header changes during a turn ("Working", a
 * reasoning-summary line, ...), so "turn in progress" is detected from the
 * stable trailing interrupt hint instead of the header text. Both patterns are
 * line-anchored: they are tested against the whole viewport, so an echoed prompt
 * or transcript line quoting the hint must not be mistaken for live UI.
 */

/** Composer placeholder shown when the composer is idle and ready for a prompt. */
const COMPOSER_IDLE_MARKER = "Ask Codex to do anything";

/**
 * A complete status-indicator line
 * (`<indicator> <header> (<elapsed> • <binding> to interrupt)`), optionally
 * followed by an inline ` · <message>`.
 *
 * The leading glyph is not pinned to `•`: with animations enabled codex blinks
 * between `•` and `◦`, so matching the glyph would miss live turns. Anchoring to
 * the elapsed/interrupt shape keeps echoed prompt text from matching.
 */
const WORKING_MARKER = /^[^\s›].*\(\d+[smh](?:[ \t]\d+[smh])*[ \t]•[ \t][^)]*to interrupt\)(?:[ \t]·[ \t].*)?[ \t]*$/m;

/** Transient banners rendered as "neither working nor idle" that are not input prompts. */
const TRANSITIONAL_MARKER = /^[ \t]*(?:Waiting for startup|Reconnecting to app-server|Loading earlier messages)\b/m;

/**
 * The confirmation form the server elicits before a destructive tool runs.
 * Codex renders the message ("Do you confirm the execution of the action?")
 * and the Yes/No options; the marker separates a real elicitation from a
 * transient "neither working nor idle" frame such as the just-submitted prompt.
 */
const ELICITATION_MARKER = /\bconfirm\b/i;

/** Whether the viewport shows an in-progress turn, regardless of the status header. */
export function isCodexWorking(text: string): boolean {
    return WORKING_MARKER.test(text);
}

/** Whether the composer is idle and ready for a prompt. */
export function isCodexComposerIdle(text: string): boolean {
    return text.includes(COMPOSER_IDLE_MARKER);
}

/** Whether the viewport shows a transient startup/reconnect banner (not a real input prompt). */
export function isCodexTransitional(text: string): boolean {
    return TRANSITIONAL_MARKER.test(text);
}

/** Whether the viewport shows the server's confirmation form. */
export function isCodexElicitation(text: string): boolean {
    return ELICITATION_MARKER.test(text);
}
