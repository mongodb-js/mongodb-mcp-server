/**
 * Light/dark theme for the Explain app, sourced from Via design tokens
 * (@via-ds/tokens) instead of hand-copied hex values.
 *
 * The mapping from generic tokens to widget roles (tree links, clock arcs,
 * badges…) is curated here — Via has no explain-specific semantics. Tokens are
 * Style Dictionary records; values are read at build time and bundled into the
 * widget HTML (no runtime token loading).
 */
import tokens from "@via-ds/tokens";

type ViaToken = { $value?: unknown };

/** CSS value of a Via design token ("" when missing/non-string). */
const css = (token: ViaToken): string => {
    const value = token.$value;
    return typeof value === "string" ? value : "";
};

/** Numeric px value of a Via dimension token ("4px" -> 4). */
const px = (token: ViaToken): number => {
    const value = token.$value;
    return typeof value === "string" ? Number.parseInt(value, 10) : 0;
};

const { color, space } = tokens;

/**
 * Layout spacing scale (numeric px) used by the tree layout math, from Via
 * space tokens. Note: these values must stay in sync with the stage card
 * styles (see ExplainTreeStage.tsx).
 */
export const spacing = {
    100: px(space["100"]),
    200: px(space["200"]),
    400: px(space["400"]),
    600: px(space["600"]),
    800: px(space["800"]),
    1600: px(space["1600"]),
} as const;

export interface ExplainTheme {
    backgroundColor: string;
    textColor: string;
    secondaryTextColor: string;
    cardBackgroundColor: string;
    cardBorderColor: string;
    linkColor: string;
    arrowColor: string;
    statsBadgeBackgroundColor: string;
    statsBadgeTextColor: string;
    shardBorderColor: string;
    shardTextColor: string;
    detailsBackgroundColor: string;
    detailsBorderColor: string;
    clockBackgroundColor: string;
    clockFaceColor: string;
    clockTextColor: string;
    clockMsColor: string;
    clockPreviousArcColor: string;
    clockCurrentArcColor: string;
    segmentedSelectedBackgroundColor: string;
    segmentedSelectedTextColor: string;
    /** Scrollbar thumb for the scrollable JSON panes (track stays transparent). */
    scrollbarThumbColor: string;
    /** Font stack for the widget chrome. */
    fontFamily: string;
}

/**
 * Host-provided CSS custom property with a Via fallback.
 *
 * Hosts may provide any subset of the MCP Apps style variables
 * (McpUiStyleVariableKey); `useHostStyles` applies them to the document, so
 * these references adopt host values where present while the Via palette (and
 * its WCAG floors) covers every other case. Roles without a clear host
 * counterpart (the tree's link/arrow/clock language) stay pure Via.
 */
const hostVar = (name: string, fallback: string): string => `var(${name}, ${fallback})`;

const viaLightTheme: ExplainTheme = {
    backgroundColor: css(color.light.background.primary),
    textColor: css(color.light.text.primary),
    secondaryTextColor: css(color.light.text.secondary),
    cardBackgroundColor: css(color.light.background.primary),
    cardBorderColor: css(color.light.border.primary),
    linkColor: css(color.neutral["400"]),
    arrowColor: css(color.neutral["400"]),
    statsBadgeBackgroundColor: css(color.blue["400"]),
    statsBadgeTextColor: css(color.neutral["000"]),
    shardBorderColor: css(color.neutral["400"]),
    shardTextColor: css(color.neutral["600"]),
    detailsBackgroundColor: css(color.light.background.primary),
    detailsBorderColor: css(color.light.border.secondary),
    clockBackgroundColor: css(color.light.background.primary),
    clockFaceColor: css(color.neutral["400"]),
    clockTextColor: css(color.neutral["600"]),
    clockMsColor: css(color.blue["400"]),
    clockPreviousArcColor: css(color.neutral["400"]),
    clockCurrentArcColor: css(color.blue["400"]),
    segmentedSelectedBackgroundColor: css(color.light.background["inverse-primary"]),
    segmentedSelectedTextColor: css(color.light.text["inverse-primary"]),
    scrollbarThumbColor: css(color.neutral["400"]),
    fontFamily: "system-ui, -apple-system, sans-serif",
};

const viaDarkTheme: ExplainTheme = {
    backgroundColor: css(color.dark.background.primary),
    textColor: css(color.dark.text.primary),
    secondaryTextColor: css(color.dark.text.secondary),
    cardBackgroundColor: css(color.dark.background.secondary),
    cardBorderColor: css(color.dark.border.primary),
    linkColor: css(color.neutral["400"]),
    arrowColor: css(color.neutral["400"]),
    statsBadgeBackgroundColor: css(color.blue["200"]),
    statsBadgeTextColor: css(color.neutral["900"]),
    shardBorderColor: css(color.neutral["400"]),
    shardTextColor: css(color.neutral["400"]),
    detailsBackgroundColor: css(color.dark.background.elevated),
    detailsBorderColor: css(color.dark.border.secondary),
    clockBackgroundColor: css(color.dark.background.primary),
    clockFaceColor: css(color.neutral["300"]),
    clockTextColor: css(color.neutral["400"]),
    clockMsColor: css(color.blue["200"]),
    clockPreviousArcColor: css(color.neutral["400"]),
    clockCurrentArcColor: css(color.blue["200"]),
    segmentedSelectedBackgroundColor: css(color.dark.background["inverse-primary"]),
    segmentedSelectedTextColor: css(color.dark.text["inverse-primary"]),
    scrollbarThumbColor: css(color.neutral["400"]),
    fontFamily: "system-ui, -apple-system, sans-serif",
};

export const lightTheme: ExplainTheme = {
    ...viaLightTheme,
    backgroundColor: hostVar("--color-background-primary", viaLightTheme.backgroundColor),
    textColor: hostVar("--color-text-primary", viaLightTheme.textColor),
    secondaryTextColor: hostVar("--color-text-secondary", viaLightTheme.secondaryTextColor),
    cardBackgroundColor: hostVar("--color-background-primary", viaLightTheme.cardBackgroundColor),
    fontFamily: hostVar("--font-sans", viaLightTheme.fontFamily),
};

export const darkTheme: ExplainTheme = {
    ...viaDarkTheme,
    backgroundColor: hostVar("--color-background-primary", viaDarkTheme.backgroundColor),
    textColor: hostVar("--color-text-primary", viaDarkTheme.textColor),
    secondaryTextColor: hostVar("--color-text-secondary", viaDarkTheme.secondaryTextColor),
    // Dark cards are elevated above the page; light cards share the page colour.
    cardBackgroundColor: hostVar("--color-background-secondary", viaDarkTheme.cardBackgroundColor),
    fontFamily: hostVar("--font-sans", viaDarkTheme.fontFamily),
};

export const getTheme = (darkMode: boolean): ExplainTheme => (darkMode ? darkTheme : lightTheme);
