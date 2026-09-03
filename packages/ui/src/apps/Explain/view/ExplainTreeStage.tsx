/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/compass-explain-plan/src/components/explain-tree/explain-tree-stage.tsx
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Deviations:
 * - LeafyGreen components (Card, KeylineCard, Subtitle, Body, Icon, Tooltip,
 *   HorizontalRule) replaced with plain styled elements driven by `theme`.
 * - The CodeMirror details pane is replaced with a scrollable <pre>.
 * - Dark mode comes in via the `theme` prop instead of useDarkMode().
 */
import React from "react";

import { Clock } from "./Clock.js";
import { spacing, type ExplainTheme } from "../theme.js";

export interface ExplainTreeStageProps {
    name: string;
    nReturned: number;
    highlights: Record<string, unknown>;
    curStageExecTimeMS: number;
    prevStageExecTimeMS: number;
    totalExecTimeMS: number;
    isShard: boolean;
    details: Record<string, unknown>;
    detailsOpen: boolean;
    onToggleDetailsClick: () => void;
    theme: ExplainTheme;
}

// NOTE: these values are used to layout the tree and must match
// the actual size of the elements.
export const defaultCardWidth = 278;
export const defaultCardHeight = 84;
export const shardCardHeight = 32;
export const highlightFieldHeight = 20;

// Instead of using CSS ellipsis which trims the text towards the end / front,
// we use this custom implementation to trim the text in middle because shard
// names could have similar text in the front and the differentiating numbers
// are generally available at the end of the name. For example: atlas-shard-0,
// atlas-shard-1, etc. The trimThreshold is taken from a hit and try approach to
// fit as many big chars as possible (worst case scenario) in the shard card
// because other sophisticated approaches require understanding font specifics
// like kerning, font-constant, etc to properly determine the width of character
// for a particular font.
export const trimInMiddle = (
    text: string,
    trimThreshold = 20,
    charsToKeepInFront = 6,
    charsToKeepInBack = 4
): string => {
    if (text.length <= trimThreshold) {
        return text;
    }

    const charsBeforeEllipsis = text.substring(0, charsToKeepInFront);
    const remainingText = text.substring(charsToKeepInFront);
    const charsAfterEllipsis = remainingText.substring(remainingText.length - charsToKeepInBack);
    return `${charsBeforeEllipsis}…${charsAfterEllipsis}`;
};

export const milliSecondsToNormalisedValue = (ms: number): { value: string; unit: "h" | "min" | "s" | "ms" } => {
    const hasDecimalPoint = (n: number): boolean => n - Math.floor(n) !== 0;
    const hours = ms / (1000 * 60 * 60);
    if (hours >= 1) {
        return {
            value: hasDecimalPoint(hours) ? hours.toFixed(1) : hours.toString(),
            unit: "h",
        };
    }

    const minutes = ms / (1000 * 60);
    if (minutes >= 1) {
        return {
            value: hasDecimalPoint(minutes) ? minutes.toFixed(1) : minutes.toString(),
            unit: "min",
        };
    }

    const seconds = ms / 1000;
    if (seconds >= 1) {
        return {
            value: hasDecimalPoint(seconds) ? seconds.toFixed(1) : seconds.toString(),
            unit: "s",
        };
    }

    return {
        value: ms.toString(),
        unit: "ms",
    };
};

const ChevronIcon: React.FunctionComponent<{ direction: "right" | "down"; color: string }> = ({ direction, color }) => (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        {direction === "right" ? (
            <path d="M6 4l4 4-4 4" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
            <path d="M4 6l4 4 4-4" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        )}
    </svg>
);

const StatsBadge: React.FunctionComponent<{
    stats: number | string;
    theme: ExplainTheme;
}> = ({ stats, theme }) => {
    const isMultiChar = String(stats).length > 1;
    return (
        <span
            style={{
                display: "inline-block",
                width: isMultiChar ? "auto" : spacing[600] - 4,
                height: spacing[600] - 4,
                lineHeight: `${spacing[600] - 4}px`,
                borderRadius: 100,
                textAlign: "center",
                fontWeight: 700,
                padding: isMultiChar ? `0 ${spacing[200]}px` : undefined,
                backgroundColor: theme.statsBadgeBackgroundColor,
                color: theme.statsBadgeTextColor,
            }}
        >
            {stats}
        </span>
    );
};

const ShardView: React.FunctionComponent<{ name: string; theme: ExplainTheme }> = ({ name, theme }) => {
    return (
        <div
            title={name}
            style={{
                borderRadius: 0,
                border: `1px solid ${theme.shardBorderColor}`,
                backgroundColor: theme.cardBackgroundColor,
                width: defaultCardWidth,
                height: spacing[800],
                paddingLeft: spacing[200],
                paddingRight: spacing[200],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
            }}
        >
            <span
                style={{
                    color: theme.shardTextColor,
                    fontSize: 16,
                    fontWeight: 600,
                    textAlign: "center",
                    overflow: "hidden",
                    textTransform: "uppercase",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {trimInMiddle(name)}
            </span>
        </div>
    );
};

const Highlight: React.FunctionComponent<{
    value: string | undefined;
    field: string;
}> = ({ field, value }) => {
    if (typeof value === "undefined") {
        return null;
    }
    return (
        <li style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span>{field}: </span>
            <strong title={value}>{value}</strong>
        </li>
    );
};

const Highlights: React.FunctionComponent<{
    highlights: Record<string, unknown>;
}> = ({ highlights }) => {
    const toDisplay = (value: unknown): string | undefined => {
        if (value === null || typeof value === "undefined") {
            return undefined;
        }
        if (typeof value === "boolean") {
            return value ? "yes" : "no";
        }
        if (typeof value === "string") {
            return value;
        }
        if (typeof value === "number") {
            return String(value);
        }
        return JSON.stringify(value);
    };
    return (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
            {Object.entries(highlights).map(([key, value], index) => (
                <Highlight key={index} field={key} value={toDisplay(value)} />
            ))}
        </ul>
    );
};

const ExecutionStats: React.FunctionComponent<{
    nReturned: number;
    prevStageExecTimeMS: number;
    curStageExecTimeMS: number;
    totalExecTimeMS: number;
    theme: ExplainTheme;
}> = ({ nReturned, prevStageExecTimeMS, curStageExecTimeMS, totalExecTimeMS, theme }) => {
    return (
        <div
            style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "1fr 110px",
                marginTop: 12,
                alignItems: "center",
            }}
        >
            <div>
                <span>Returned </span>
                <StatsBadge stats={nReturned} theme={theme} />
            </div>
            <div>
                <span>Execution Time</span>
                <span>
                    <div
                        style={{
                            position: "absolute",
                            top: -spacing[800],
                            right: -(8 + spacing[800]),
                        }}
                    >
                        <Clock
                            prevStageExecTimeMS={prevStageExecTimeMS}
                            curStageExecTimeMS={curStageExecTimeMS}
                            totalExecTimeMS={totalExecTimeMS}
                            theme={theme}
                        />
                    </div>
                </span>
            </div>
        </div>
    );
};

const StageView: React.FunctionComponent<Omit<ExplainTreeStageProps, "isShard">> = (props) => {
    return (
        <>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: spacing[200],
                    cursor: "pointer",
                }}
            >
                <ChevronIcon direction={props.detailsOpen ? "down" : "right"} color={props.theme.textColor} />
                <strong
                    style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 14,
                    }}
                >
                    {props.name}
                </strong>
            </div>

            <ExecutionStats
                nReturned={props.nReturned}
                prevStageExecTimeMS={props.prevStageExecTimeMS}
                curStageExecTimeMS={props.curStageExecTimeMS}
                totalExecTimeMS={props.totalExecTimeMS}
                theme={props.theme}
            />

            {Object.keys(props.highlights).length > 0 && (
                <div>
                    <hr
                        style={{
                            marginTop: spacing[200],
                            marginBottom: spacing[200],
                            border: "none",
                            borderTop: `1px solid ${props.theme.cardBorderColor}`,
                        }}
                    />
                    <Highlights highlights={props.highlights}></Highlights>
                </div>
            )}

            {props.detailsOpen && (
                <div
                    style={{
                        marginTop: spacing[400],
                        overflow: "hidden",
                        border: `1px solid ${props.theme.detailsBorderColor}`,
                        borderRadius: spacing[200],
                        backgroundColor: props.theme.detailsBackgroundColor,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <pre
                        data-testid="explain-stage-details"
                        style={{
                            margin: 0,
                            padding: spacing[200],
                            maxHeight: 15 * 18,
                            overflow: "auto",
                            fontSize: 11,
                            lineHeight: "18px",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {JSON.stringify(props.details, null, " ") || "{}"}
                    </pre>
                </div>
            )}
        </>
    );
};

export const ExplainTreeStage: React.FunctionComponent<ExplainTreeStageProps> = ({
    name = "",
    nReturned = 0,
    isShard = false,
    totalExecTimeMS = 1,
    curStageExecTimeMS = 0,
    prevStageExecTimeMS = 0,
    highlights = {},
    details = {},
    detailsOpen = false,
    onToggleDetailsClick = (): void => {},
    theme,
}) => {
    if (isShard) {
        return <ShardView name={name} theme={theme} />;
    }

    return (
        <div
            data-testid="explain-stage"
            role="button"
            tabIndex={0}
            onClick={onToggleDetailsClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleDetailsClick();
                }
            }}
            style={{
                position: "absolute",
                width: defaultCardWidth,
                padding: 14,
                borderRadius: spacing[200],
                backgroundColor: theme.cardBackgroundColor,
                color: theme.textColor,
                border: `1px solid ${theme.cardBorderColor}`,
                boxShadow: detailsOpen ? "0 2px 10px rgba(0, 30, 43, 0.35)" : "none",
                cursor: "pointer",
                boxSizing: "border-box",
                fontSize: 12,
            }}
        >
            <div style={{ position: "relative" }}>
                <StageView
                    name={name}
                    nReturned={nReturned}
                    highlights={highlights}
                    curStageExecTimeMS={curStageExecTimeMS}
                    prevStageExecTimeMS={prevStageExecTimeMS}
                    totalExecTimeMS={totalExecTimeMS}
                    onToggleDetailsClick={onToggleDetailsClick}
                    detailsOpen={detailsOpen}
                    details={details}
                    theme={theme}
                />
            </div>
        </div>
    );
};
