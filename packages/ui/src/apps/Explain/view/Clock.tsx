/**
 * Rewritten from mongodb/compass @ adad060c5e
 * Source: packages/compass-explain-plan/src/components/explain-tree/clock.tsx
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * The original draws imperatively with d3 v3 (`d3.svg.arc` + `d3.select` DOM
 * mutation); this is an equivalent pure-React SVG implementation.
 */
import React, { useMemo } from "react";
import { milliSecondsToNormalisedValue } from "./ExplainTreeStage.js";
import type { ExplainTheme } from "../theme.js";

export type ClockProps = {
    totalExecTimeMS: number;
    curStageExecTimeMS: number;
    prevStageExecTimeMS: number;
    theme: ExplainTheme;
};

const CLOCK_SIZE = 50;
const ARC_STROKE_WIDTH = 5;

/** 0 rad = 12 o'clock, clockwise — matches the d3.svg.arc convention. */
function polarToCartesian(center: number, radius: number, angle: number): { x: number; y: number } {
    return {
        x: center + radius * Math.sin(angle),
        y: center - radius * Math.cos(angle),
    };
}

/** SVG path for a ring segment (annular sector) between two angles in radians. */
function describeRingSegment(
    center: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number
): string {
    const outerStart = polarToCartesian(center, outerRadius, startAngle);
    const outerEnd = polarToCartesian(center, outerRadius, endAngle);
    const innerStart = polarToCartesian(center, innerRadius, endAngle);
    const innerEnd = polarToCartesian(center, innerRadius, startAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerStart.x} ${innerStart.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
        "Z",
    ].join(" ");
}

export const Clock: React.FunctionComponent<ClockProps> = ({
    totalExecTimeMS,
    curStageExecTimeMS,
    prevStageExecTimeMS,
    theme,
}) => {
    const { value: deltaValue, unit: deltaUnit } = useMemo(
        () => milliSecondsToNormalisedValue(curStageExecTimeMS - prevStageExecTimeMS),
        [curStageExecTimeMS, prevStageExecTimeMS]
    );

    const center = CLOCK_SIZE / 2;

    // `|| 0` guards against NaN when totalExecTimeMS is 0 (matches source).
    const curArcStart = (prevStageExecTimeMS / totalExecTimeMS) * 2 * Math.PI || 0;
    const curArcEnd = (curStageExecTimeMS / totalExecTimeMS) * 2 * Math.PI || 0;

    // A full-circle arc is degenerate as a path; clamp just below 2π.
    const maxAngle = 2 * Math.PI - 0.001;

    const tickAngles = [0, 45, 90, 135, 180, 225, 270, 315];
    const tickLength = 0.3 * center;

    return (
        <div
            style={{
                position: "relative",
                width: CLOCK_SIZE,
                height: CLOCK_SIZE,
                fontSize: 10,
                textAlign: "center",
                fontWeight: "normal",
                color: theme.clockTextColor,
            }}
            title={`The clock represents the total time the query took to complete. The highlighted segment is the time taken by this stage (${
                curStageExecTimeMS - prevStageExecTimeMS
            } ms). The rest is the time taken by preceding stages.`}
        >
            <svg width={CLOCK_SIZE} height={CLOCK_SIZE} style={{ position: "absolute", top: 0, left: 0 }}>
                {/* clock face + border */}
                <circle
                    cx={center}
                    cy={center}
                    r={center - 0.5}
                    fill={theme.clockFaceColor}
                    stroke={theme.clockTextColor}
                    strokeWidth={1}
                />
                {/* clock position ticks */}
                {tickAngles.map((angle) => {
                    const rad = (angle * Math.PI) / 180;
                    return (
                        <line
                            key={angle}
                            x1={center + (center - tickLength) * Math.sin(rad)}
                            y1={center - (center - tickLength) * Math.cos(rad)}
                            x2={center + center * Math.sin(rad)}
                            y2={center - center * Math.cos(rad)}
                            stroke={theme.clockTextColor}
                            strokeWidth={1}
                        />
                    );
                })}
                {/* elapsed-time arcs, straddling the face edge */}
                {curArcStart > 0 && (
                    <path
                        d={describeRingSegment(
                            center,
                            center + ARC_STROKE_WIDTH / 2,
                            center - ARC_STROKE_WIDTH / 2,
                            0,
                            Math.min(curArcStart, maxAngle)
                        )}
                        fill={theme.clockPreviousArcColor}
                    />
                )}
                {curArcEnd > curArcStart && (
                    <path
                        d={describeRingSegment(
                            center,
                            center + ARC_STROKE_WIDTH / 2,
                            center - ARC_STROKE_WIDTH / 2,
                            curArcStart,
                            Math.min(curArcEnd, maxAngle)
                        )}
                        fill={theme.clockCurrentArcColor}
                    />
                )}
            </svg>
            <div
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: CLOCK_SIZE,
                    height: CLOCK_SIZE,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                }}
            >
                <div style={{ fontWeight: "bold", fontSize: 13, lineHeight: "13px", color: theme.clockMsColor }}>
                    {deltaValue}
                </div>
                <div style={{ fontSize: 11, lineHeight: "11px" }}>{deltaUnit}</div>
            </div>
        </div>
    );
};
