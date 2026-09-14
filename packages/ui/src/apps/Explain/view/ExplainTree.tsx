/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/compass-explain-plan/src/components/explain-tree/explain-tree.tsx
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Deviation: dark mode comes in via the `darkMode` prop (mapped to a local
 * theme) instead of @mongodb-js/compass-components' useDarkMode(); LeafyGreen
 * spacing tokens are local constants.
 */
import React, { useState, useMemo } from "react";

import type { ExplainTreeNodeData } from "../logic/treeData.js";
import { executionStatsToTreeData } from "../logic/treeData.js";
import type { ExecutionStats } from "../logic/getExecutionStats.js";
import TreeLayout from "./TreeLayout.js";
import {
    defaultCardHeight,
    defaultCardWidth,
    highlightFieldHeight,
    ExplainTreeStage,
    shardCardHeight,
} from "./ExplainTreeStage.js";
import { getTheme, spacing } from "../theme.js";

interface ExplainTreeProps {
    executionStats: ExecutionStats | undefined;
    darkMode: boolean;
    scale?: number;
}

const TREE_VERTICAL_SPACING = 38;
const TREE_VERTICAL_SPACING_BELOW_SHARD_CARD = 12;
const TREE_HORIZONTAL_SPACING = spacing[1600];

const getNodeSize = (node: ExplainTreeNodeData): [number, number] => {
    // Note: these values must match the actual styles of the explain stage card:

    const highlightsHeight = Object.keys(node.highlights).length * highlightFieldHeight;

    const notShardHeight = defaultCardHeight + highlightsHeight;
    const height = node.isShard
        ? // In tree layout we add `TREE_VERTICAL_SPACING` amount to the height of the
          // node to account for gap. Here we wish to reduce the space between a shard
          // card and its descendent and to keep the layout logic decoupled from the
          // index tree specifics we reduce that amount and add our custom amount of
          // space for a shard card
          shardCardHeight + TREE_VERTICAL_SPACING_BELOW_SHARD_CARD - TREE_VERTICAL_SPACING
        : notShardHeight;

    return [defaultCardWidth, height];
};

type LinkWidthMetadata = { isFirstVerticalHalf?: boolean };

const getLinkWidth = (
    sourceNode: ExplainTreeNodeData,
    targetNode: ExplainTreeNodeData,
    metaData?: LinkWidthMetadata
): number => {
    if (sourceNode.isShard || targetNode.isShard) {
        if (metaData?.isFirstVerticalHalf) {
            return spacing[600];
        }

        return spacing[200];
    }

    return spacing[100];
};

const getNodeKey = (node: ExplainTreeNodeData): string => node.id;

const srOnlyStyle: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
};

/** Visually hidden text outline of the tree, mirroring its parent/child structure. */
const TreeOutline: React.FunctionComponent<{ node: ExplainTreeNodeData }> = ({ node }) => (
    <li>
        {node.name}
        {node.children.length > 0 && (
            <ul style={{ margin: 0 }}>
                {node.children.map((child) => (
                    <TreeOutline key={child.id} node={child} />
                ))}
            </ul>
        )}
    </li>
);

export const ExplainTree: React.FunctionComponent<ExplainTreeProps> = ({ executionStats, darkMode, scale }) => {
    const theme = getTheme(darkMode);
    const [detailsOpen, setDetailsOpen] = useState<string | null>(null);
    const [focused, setFocused] = useState<string | null>(null);

    const root = useMemo(() => executionStatsToTreeData(executionStats), [executionStats]);

    if (!root) return null;

    return (
        <>
            <TreeLayout<ExplainTreeNodeData, LinkWidthMetadata>
                data-testid="explain-tree"
                data={root}
                getNodeSize={getNodeSize}
                getNodeKey={getNodeKey}
                linkColor={theme.linkColor}
                arrowColor={theme.arrowColor}
                getLinkWidth={getLinkWidth}
                horizontalSpacing={TREE_HORIZONTAL_SPACING}
                verticalSpacing={TREE_VERTICAL_SPACING}
                scale={scale}
            >
                {(node) => {
                    const key = getNodeKey(node);
                    return (
                        <div
                            onFocus={() => setFocused(key)}
                            onBlur={() => {
                                setFocused((current) => (current === key ? null : current));
                            }}
                            style={{
                                position: "relative",
                                // A sibling's open details pane extends into this
                                // card's space; keep the focused card above it so
                                // focus is never obscured (WCAG 2.4.11).
                                zIndex: focused === key ? 3 : detailsOpen === key ? 2 : 1,
                            }}
                        >
                            <ExplainTreeStage
                                detailsOpen={detailsOpen === key}
                                onToggleDetailsClick={() => {
                                    setDetailsOpen(detailsOpen === key ? null : key);
                                }}
                                {...node}
                                totalExecTimeMS={root.curStageExecTimeMS}
                                theme={theme}
                            ></ExplainTreeStage>
                        </div>
                    );
                }}
            </TreeLayout>
            {/* The absolutely-positioned cards convey hierarchy visually only;
                this hidden outline makes the parent/child structure available
                to assistive tech (WCAG 1.3.1). */}
            <div style={srOnlyStyle} role="group" aria-label="Explain plan tree (text outline)">
                <ul style={{ margin: 0 }}>
                    <TreeOutline node={root} />
                </ul>
            </div>
        </>
    );
};
