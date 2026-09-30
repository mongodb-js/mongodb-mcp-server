/**
 * Codex TUI markers.
 *
 * The status indicator's header changes during a turn ("Working", a
 * reasoning-summary line, ...), so "turn in progress" is detected from the
 * stable trailing interrupt hint instead of the header text.
 */

/** Composer placeholder shown when the composer is idle and ready for a prompt. */
const COMPOSER_IDLE_MARKER = "Ask Codex to do anything";

/** Stable trailing interrupt hint on the status indicator (`(<elapsed> • <binding> to interrupt)`). */
const WORKING_MARKER = /•\s*.*to interrupt\)/;

/** Transient banners rendered as "neither working nor idle" that are not input prompts. */
const TRANSITIONAL_MARKER = /Waiting for startup|Reconnecting to app-server|Loading earlier messages/i;

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
