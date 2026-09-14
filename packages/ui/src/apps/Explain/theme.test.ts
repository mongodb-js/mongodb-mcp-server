import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme, type ExplainTheme } from "./theme.js";

/**
 * WCAG 2.2 AA contrast floors for the theme roles.
 *
 * Text roles must meet 1.4.3 (4.5:1 for normal text); structure roles that
 * carry meaning — tree links/arrows, card borders, clock face and arcs — must
 * meet 1.4.11 (3:1 non-text contrast). Regression guard for the light-theme
 * remap: shard labels/clock text used to sit at 3.15:1 and the tree's
 * structure layer at 1.18:1.
 */

/**
 * Theme roles that reference host style variables use `var(--x, <fallback>)`;
 * the fallback (the Via palette) is what renders when the host provides no
 * variables, so that is what the contrast floors are asserted against.
 */
const resolveFallback = (value: string): string => {
    const match = /^var\([^,]+,\s*(.+)\)$/.exec(value);
    return match?.[1] ?? value;
};

const parseRgb = (value: string): [number, number, number] => {
    const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(value);
    if (!match) {
        throw new Error(`Unsupported color value: "${value}"`);
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const relativeLuminance = ([r, g, b]: [number, number, number]): number => {
    const [rs, gs, bs] = [r, g, b].map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const contrastRatio = (foreground: string, background: string): number => {
    const [lighter, darker] = [relativeLuminance(parseRgb(foreground)), relativeLuminance(parseRgb(background))].sort(
        (a, b) => b - a
    ) as [number, number];
    return (lighter + 0.05) / (darker + 0.05);
};

const themes: Array<[string, ExplainTheme]> = [
    ["light", lightTheme],
    ["dark", darkTheme],
];

const textPairs: Array<[keyof ExplainTheme, keyof ExplainTheme]> = [
    ["textColor", "backgroundColor"],
    ["secondaryTextColor", "backgroundColor"],
    ["shardTextColor", "cardBackgroundColor"],
    ["clockTextColor", "clockBackgroundColor"],
    ["clockMsColor", "clockBackgroundColor"],
    ["statsBadgeTextColor", "statsBadgeBackgroundColor"],
    ["segmentedSelectedTextColor", "segmentedSelectedBackgroundColor"],
];

const structurePairs: Array<[keyof ExplainTheme, keyof ExplainTheme]> = [
    ["cardBorderColor", "cardBackgroundColor"],
    ["shardBorderColor", "cardBackgroundColor"],
    ["linkColor", "backgroundColor"],
    ["arrowColor", "backgroundColor"],
    ["clockFaceColor", "clockBackgroundColor"],
    ["clockPreviousArcColor", "clockBackgroundColor"],
    ["clockCurrentArcColor", "clockBackgroundColor"],
    ["scrollbarThumbColor", "backgroundColor"],
];

describe("Explain theme contrast", () => {
    for (const [name, theme] of themes) {
        describe(name, () => {
            it.each(textPairs)("%s on %s meets 4.5:1", (foreground, background) => {
                const ratio = contrastRatio(resolveFallback(theme[foreground]), resolveFallback(theme[background]));
                expect(ratio, `${name}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
                    4.5
                );
            });

            it.each(structurePairs)("%s on %s meets 3:1", (foreground, background) => {
                const ratio = contrastRatio(resolveFallback(theme[foreground]), resolveFallback(theme[background]));
                expect(ratio, `${name}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
                    3
                );
            });
        });
    }

    it("adopts host style variables for the foundational roles, with Via fallbacks", () => {
        for (const theme of [lightTheme, darkTheme]) {
            expect(theme.backgroundColor).toMatch(/^var\(--color-background-primary, /);
            expect(theme.textColor).toMatch(/^var\(--color-text-primary, /);
            expect(theme.secondaryTextColor).toMatch(/^var\(--color-text-secondary, /);
            expect(theme.fontFamily).toMatch(/^var\(--font-sans, /);
        }
        expect(lightTheme.cardBackgroundColor).toMatch(/^var\(--color-background-primary, /);
        expect(darkTheme.cardBackgroundColor).toMatch(/^var\(--color-background-secondary, /);
    });
});
