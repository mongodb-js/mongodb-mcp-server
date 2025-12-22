import { css } from "@emotion/css";
import { color, InteractionState, Property, spacing, Variant } from "@leafygreen-ui/tokens";
import { Theme } from "@leafygreen-ui/lib";

export const getContainerStyles = (darkMode: boolean): string => css`
    background-color: ${color[darkMode ? Theme.Dark : Theme.Light][Property.Background][Variant.Primary][
        InteractionState.Default
    ]};
    padding: ${spacing[200]}px;
`;

export const AmountTextStyles = css`
    margin-bottom: ${spacing[400]}px;
`;
