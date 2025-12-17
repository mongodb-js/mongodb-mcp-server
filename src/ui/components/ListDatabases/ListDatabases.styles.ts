import { css } from "@emotion/css";
import { color, InteractionState, Property, spacing, Variant } from "@leafygreen-ui/tokens";

export const getContainerStyles = (darkMode: boolean): string => css`
    background-color: ${color[darkMode ? "dark" : "light"][Property.Background][Variant.Primary][
        InteractionState.Default
    ]};
    padding: ${spacing[200]}px;
`;

export const AmountTextStyles = css`
    margin-bottom: ${spacing[400]}px;
`;
