/**
 * Light/dark theme tokens for the Explain app.
 *
 * Hex values mirror @leafygreen-ui/palette as used by the Compass explain plan
 * UI, verified against the palette version in mongodb/compass @ adad060c5e
 * (note: gray.light1 is #C1C7C6 and gray.light2 is #E8EDEB in the current
 * palette; dark2 is #3D4F58).
 */

export const palette = {
    white: "#FFFFFF",
    black: "#001E2B",
    gray: {
        light1: "#C1C7C6",
        light2: "#E8EDEB",
        base: "#889397",
        dark2: "#3D4F58",
        dark3: "#1C2D38",
        dark4: "#112733",
    },
    blue: {
        base: "#016BF8",
        light1: "#0498EC",
        light2: "#C3E7FE",
    },
} as const;

/** Mirrors the @leafygreen-ui/tokens spacing scale members used by Compass. */
export const spacing = {
    100: 4,
    200: 8,
    400: 16,
    600: 24,
    800: 32,
    1600: 64,
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
}

export const lightTheme: ExplainTheme = {
    backgroundColor: palette.white,
    textColor: palette.gray.dark3,
    secondaryTextColor: palette.gray.base,
    cardBackgroundColor: palette.white,
    cardBorderColor: palette.gray.light2,
    linkColor: palette.gray.light2,
    arrowColor: palette.gray.light1,
    statsBadgeBackgroundColor: palette.blue.base,
    statsBadgeTextColor: palette.white,
    shardBorderColor: palette.gray.base,
    shardTextColor: palette.gray.base,
    detailsBackgroundColor: palette.white,
    detailsBorderColor: palette.gray.light2,
    clockBackgroundColor: palette.white,
    clockFaceColor: palette.gray.light1,
    clockTextColor: palette.gray.base,
    clockMsColor: palette.blue.base,
    clockPreviousArcColor: palette.gray.light2,
    clockCurrentArcColor: palette.blue.base,
};

export const darkTheme: ExplainTheme = {
    backgroundColor: palette.black,
    textColor: palette.gray.light2,
    secondaryTextColor: palette.gray.base,
    cardBackgroundColor: palette.gray.dark4,
    // Compass applies a gray.light2 border to cards in dark mode
    cardBorderColor: palette.gray.light2,
    linkColor: palette.gray.dark2,
    arrowColor: palette.gray.base,
    statsBadgeBackgroundColor: palette.blue.light2,
    statsBadgeTextColor: palette.black,
    shardBorderColor: palette.gray.base,
    shardTextColor: palette.gray.base,
    detailsBackgroundColor: palette.gray.dark3,
    detailsBorderColor: palette.gray.dark2,
    clockBackgroundColor: palette.black,
    clockFaceColor: palette.gray.light1,
    clockTextColor: palette.gray.base,
    clockMsColor: palette.blue.light2,
    clockPreviousArcColor: palette.gray.dark2,
    clockCurrentArcColor: palette.blue.light2,
};

export const getTheme = (darkMode: boolean): ExplainTheme => (darkMode ? darkTheme : lightTheme);
