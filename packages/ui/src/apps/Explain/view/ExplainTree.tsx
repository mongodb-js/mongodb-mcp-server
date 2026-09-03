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

export const ExplainTree: React.FunctionComponent<ExplainTreeProps> = ({ executionStats, darkMode, scale }) => {
    const theme = getTheme(darkMode);
    const [detailsOpen, setDetailsOpen] = useState<string | null>(null);

    const root = useMemo(() => executionStatsToTreeData(executionStats), [executionStats]);

    if (!root) return null;

    return (
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
                        style={{
                            position: "relative",
                            zIndex: detailsOpen === key ? 2 : 1,
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
    );
};
