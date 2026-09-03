import React from "react";
import { spacing, type ExplainTheme } from "../theme.js";

interface SegmentedControlOption {
    value: string;
    label: string;
    icon?: React.ReactNode;
}

interface SegmentedControlProps {
    options: SegmentedControlOption[];
    value: string;
    onChange: (value: string) => void;
    theme: ExplainTheme;
}

/**
 * Minimal segmented control (cf. Compass's Visual Tree / Raw Output toggle).
 * Selected segment renders as an inverse (dark-on-light / light-on-dark) pill.
 */
export const SegmentedControl: React.FunctionComponent<SegmentedControlProps> = ({
    options,
    value,
    onChange,
    theme,
}) => {
    return (
        <div
            role="group"
            aria-label="Explain view"
            style={{
                display: "inline-flex",
                gap: 2,
                padding: 2,
                border: `1px solid ${theme.cardBorderColor}`,
                borderRadius: spacing[200],
                backgroundColor: theme.cardBackgroundColor,
            }}
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(option.value)}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: spacing[100],
                            padding: `${spacing[100]}px ${spacing[200]}px`,
                            border: "none",
                            borderRadius: spacing[200] - 2,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: selected ? 600 : 400,
                            color: selected ? theme.segmentedSelectedTextColor : theme.secondaryTextColor,
                            backgroundColor: selected ? theme.segmentedSelectedBackgroundColor : "transparent",
                        }}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
};
