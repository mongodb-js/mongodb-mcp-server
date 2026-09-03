import React, { useEffect, useMemo, useState, type ReactElement } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExplainOutput } from "@mongodb-js/mcp-tools-mongodb";
import { ExplainPlan, type Stage } from "./logic/ExplainPlan.js";
import { ExplainTree } from "./view/ExplainTree.js";
import { getTheme, spacing, type ExplainTheme } from "./theme.js";

/** The host delivers the full CallToolResult via `ui/notifications/tool-result`. */
type ToolResult = CallToolResult;

const APP_INFO = { name: "mongodb-mcp-explain", version: "0.0.0-poc" } as const;

const panelStyle = (theme: ExplainTheme): React.CSSProperties => ({
    border: `1px solid ${theme.cardBorderColor}`,
    borderRadius: spacing[200],
    backgroundColor: theme.cardBackgroundColor,
    padding: spacing[400],
});

const RawExplain: React.FunctionComponent<{ data: unknown; theme: ExplainTheme }> = ({ data, theme }) => (
    <details style={{ marginTop: spacing[400] }}>
        <summary style={{ cursor: "pointer", color: theme.secondaryTextColor }}>Raw explain output</summary>
        <pre
            data-testid="explain-raw-output"
            style={{
                maxHeight: 320,
                overflow: "auto",
                fontSize: 11,
                lineHeight: "16px",
                padding: spacing[200],
                border: `1px solid ${theme.detailsBorderColor}`,
                borderRadius: spacing[200],
                backgroundColor: theme.detailsBackgroundColor,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
            }}
        >
            {JSON.stringify(data, null, 2)}
        </pre>
    </details>
);

const SummaryBar: React.FunctionComponent<{
    plan: ExplainPlan;
    method: string;
    verbosity: string;
    theme: ExplainTheme;
}> = ({ plan, method, verbosity, theme }) => {
    const items: Array<[string, string | number | null | undefined]> = [
        ["Namespace", plan.namespace],
        ["Method", method],
        ["Verbosity", verbosity],
        ["Returned", plan.nReturned],
        ["Execution Time", plan.executionTimeMillis !== null ? `${plan.executionTimeMillis} ms` : null],
        ["Docs Examined", plan.totalDocsExamined],
        ["Keys Examined", plan.totalKeysExamined],
        ["Index", plan.indexType],
    ];
    if (plan.isSharded) {
        items.push(["Shards", plan.numShards]);
    }
    return (
        <div
            data-testid="explain-summary"
            style={{
                ...panelStyle(theme),
                display: "flex",
                flexWrap: "wrap",
                gap: `${spacing[200]}px ${spacing[600]}px`,
                marginBottom: spacing[400],
                fontSize: 12,
            }}
        >
            {items
                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                .map(([label, value]) => (
                    <span key={label}>
                        <span style={{ color: theme.secondaryTextColor }}>{label}: </span>
                        <strong>{String(value)}</strong>
                    </span>
                ))}
        </div>
    );
};

/** Renders the winning plan's stage names as a nested outline (planner-only view). */
const StageOutline: React.FunctionComponent<{ stage: Stage; theme: ExplainTheme; depth?: number }> = ({
    stage,
    theme,
    depth = 0,
}) => {
    if (depth > 12) {
        return null;
    }
    return (
        <li>
            <span style={{ color: theme.textColor }}>{stage.stage ?? (stage.shardName as string)}</span>
            {[...ExplainPlan.getChildStages(stage)].length > 0 && (
                <ul style={{ margin: 0, paddingLeft: spacing[400] }}>
                    {[...ExplainPlan.getChildStages(stage)].map((child, i) => (
                        <StageOutline key={i} stage={child} theme={theme} depth={depth + 1} />
                    ))}
                </ul>
            )}
        </li>
    );
};

const PlannerOnlyFallback: React.FunctionComponent<{ plan: ExplainPlan; verbosity: string; theme: ExplainTheme }> = ({
    plan,
    verbosity,
    theme,
}) => (
    <div style={panelStyle(theme)}>
        <p style={{ marginTop: 0 }}>
            <strong>Planner-only output (verbosity: {verbosity}).</strong>
        </p>
        <p style={{ color: theme.secondaryTextColor }}>
            Re-run explain with <code>verbosity: &quot;executionStats&quot;</code> to see the visual plan tree with
            per-stage timing.
        </p>
        {plan.winningPlan && (
            <>
                <p style={{ color: theme.secondaryTextColor, marginBottom: spacing[200] }}>Winning plan stages:</p>
                <ul data-testid="explain-planner-outline" style={{ margin: 0, paddingLeft: spacing[400] }}>
                    <StageOutline stage={plan.winningPlan} theme={theme} />
                </ul>
            </>
        )}
        <RawExplain data={plan.originalExplainData} theme={theme} />
    </div>
);

export const Explain = (): ReactElement => {
    const [result, setResult] = useState<ToolResult | null>(null);
    const [darkMode, setDarkMode] = useState(false);

    const { app, error } = useApp({
        appInfo: APP_INFO,
        capabilities: {},
        onAppCreated: (appInstance) => {
            appInstance.ontoolresult = (params): void => {
                setResult(params);
            };
            appInstance.onhostcontextchanged = (ctx): void => {
                if (ctx?.theme) {
                    setDarkMode(ctx.theme === "dark");
                }
            };
        },
    });

    useEffect(() => {
        const hostTheme = app?.getHostContext()?.theme;
        if (hostTheme) {
            setDarkMode(hostTheme === "dark");
        }
    }, [app]);

    const theme = getTheme(darkMode);

    const { plan, planError, data } = useMemo(() => {
        const data = result?.structuredContent as ExplainOutput | undefined;
        if (!data?.explainResult) {
            return { plan: null, planError: null, data };
        }
        try {
            return { plan: new ExplainPlan(data.explainResult as Stage), planError: null, data };
        } catch (e) {
            return { plan: null, planError: e as Error, data };
        }
    }, [result]);

    let body: ReactElement;
    if (error) {
        body = (
            <div role="alert" style={panelStyle(theme)}>
                <strong>Failed to connect to the host:</strong> {error.message}
            </div>
        );
    } else if (!data?.explainResult) {
        body = (
            <div data-testid="explain-waiting" style={{ ...panelStyle(theme), color: theme.secondaryTextColor }}>
                {app ? "Waiting for explain result…" : "Connecting to host…"}
            </div>
        );
    } else if (planError || !plan) {
        body = (
            <div role="alert" style={panelStyle(theme)}>
                <p style={{ marginTop: 0 }}>
                    <strong>Could not parse the explain output.</strong>{" "}
                    {planError ? planError.message : "Unknown error."}
                </p>
                <RawExplain data={data.explainResult} theme={theme} />
            </div>
        );
    } else if (plan.executionStats?.executionStages) {
        body = (
            <>
                <SummaryBar plan={plan} method={data.method} verbosity={data.verbosity} theme={theme} />
                <ExplainTree executionStats={plan.executionStats} darkMode={darkMode} />
                <RawExplain data={plan.originalExplainData} theme={theme} />
            </>
        );
    } else {
        body = <PlannerOnlyFallback plan={plan} verbosity={data.verbosity} theme={theme} />;
    }

    return (
        <main
            data-testid="explain-app"
            style={{
                fontFamily: "system-ui, -apple-system, sans-serif",
                backgroundColor: theme.backgroundColor,
                color: theme.textColor,
                minHeight: "100vh",
                padding: spacing[400],
                boxSizing: "border-box",
            }}
        >
            {/* Local reset: the shared HTML template has no global styles */}
            <style>{"body { margin: 0; }"}</style>
            {body}
        </main>
    );
};
