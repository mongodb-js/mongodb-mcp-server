import React, { useEffect, useState, useRef, type ReactElement } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { EJSON } from "bson";
import { AppShell, Label, Text, Loading, ErrorText, Code, Heading, TreeValue } from "../../components/elements.js";

// Mirrors src/tools/mongodb/read/find.ts FindArgs
// TODO: deduplicate with FindArgsSchema in src/tools/mongodb/read/find.ts once
// the circular dependency issues are resolved
const FindArgsSchema = z.object({
    filter: z.record(z.string(), z.unknown()).optional(),
    projection: z.object({}).passthrough().optional(),
    limit: z.number().optional(),
    sort: z.record(z.string(), z.union([z.literal(1), z.literal(-1), z.literal("asc"), z.literal("desc")])).optional(),
});

// Mirrors src/tools/mongodb/read/aggregate.ts AggregateArgs
// TODO: deduplicate with AggregateArgsSchema in
// src/tools/mongodb/read/aggregate.ts once the circular dependency issues are
// resolved
const AggregateArgsSchema = z.object({
    pipeline: z.array(z.record(z.string(), z.unknown())),
});

const FindQuerySchema = z.object({ find: FindArgsSchema });
const AggregateQuerySchema = z.object({ aggregate: AggregateArgsSchema });
const QuerySchema = z.union([FindQuerySchema, AggregateQuerySchema]);

const RenderDataSchema = z.object({
    database: z.string(),
    collection: z.string(),
    query: QuerySchema,
});

type FindQuery = z.infer<typeof FindQuerySchema>;
type AggregateQuery = z.infer<typeof AggregateQuerySchema>;
type RenderData = z.infer<typeof RenderDataSchema>;

function isFindQuery(q: z.infer<typeof QuerySchema>): q is FindQuery {
    return "find" in q;
}

function isAggregateQuery(q: z.infer<typeof QuerySchema>): q is AggregateQuery {
    return "aggregate" in q;
}

// Passed via resource._meta by the tool for hosts that support it
const INITIAL_RENDER_DATA_KEY = "mcpui.dev/ui-initial-render-data";

export const DocumentBrowser = (): ReactElement => {
    const [renderData, setRenderData] = useState<RenderData | null>(null);
    const [renderDataError, setRenderDataError] = useState<string | null>(null);

    const {
        app,
        isConnected,
        error: hostError,
    } = useApp({
        appInfo: { name: "document-browser", version: "1.0.0" },
        capabilities: {},
        // Register ontoolinput before the connection handshake so we don't miss it.
        // This is the standard mechanism hosts use to deliver tool arguments to the app.
        onAppCreated: (createdApp) => {
            createdApp.ontoolinput = (params) => {
                const parsed = RenderDataSchema.safeParse(params.arguments);
                if (parsed.success) {
                    setRenderData(parsed.data);
                } else {
                    setRenderDataError(parsed.error.issues.map((i) => i.message).join(", "));
                }
            };
        },
    });

    useHostStyles(app, app?.getHostContext());

    // ext-apps 1.2.0 bug: useHostFonts overwrites useHostStyleVariables' onhostcontextchanged
    // subscription, so runtime theme/variable changes are silently dropped. Chain on top.
    useEffect(() => {
        if (!app) return;
        const prev = app.onhostcontextchanged;
        app.onhostcontextchanged = (ctx) => {
            prev?.(ctx);
            if (ctx.theme) {
                document.documentElement.setAttribute("data-theme", ctx.theme);
                document.documentElement.style.colorScheme = ctx.theme;
            }
            if (ctx.styles?.variables) {
                for (const [k, v] of Object.entries(ctx.styles.variables)) {
                    if (v != null) document.documentElement.style.setProperty(k, v);
                }
            }
        };
        return () => {
            app.onhostcontextchanged = prev;
        };
    }, [app]);

    // Fallback: some hosts embed the tool args in resource._meta under this key
    useEffect(() => {
        if (!isConnected || renderData) return;
        const parsed = RenderDataSchema.safeParse(app?.getHostContext()?.[INITIAL_RENDER_DATA_KEY]);
        if (parsed.success) {
            setRenderData(parsed.data);
        }
    }, [app, isConnected, renderData]);

    const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
    const [result, setResult] = useState<CallToolResult | null>(null);
    const [toolError, setToolError] = useState<string | null>(null);
    const hasRun = useRef(false);

    useEffect(() => {
        if (!app || !isConnected || !renderData || hasRun.current) return;

        hasRun.current = true;
        const { database, collection, query } = renderData;

        const toolParams = isFindQuery(query)
            ? { name: "find", arguments: { database, collection, ...query.find } }
            : { name: "aggregate", arguments: { database, collection, ...query.aggregate } };

        setStatus("loading");
        app.callServerTool(toolParams)
            .then((r) => {
                setResult(r);
                setStatus("done");
            })
            .catch((err: unknown) => {
                setToolError(err instanceof Error ? err.message : String(err));
                setStatus("done");
            });
    }, [app, isConnected, renderData]);

    if (hostError) {
        return (
            <AppShell>
                <ErrorText>Failed to connect to MCP host: {hostError.message}</ErrorText>
            </AppShell>
        );
    }

    if (!renderData) {
        if (renderDataError) {
            return (
                <AppShell>
                    <ErrorText>Invalid query parameters: {renderDataError}</ErrorText>
                </AppShell>
            );
        }
        return (
            <AppShell>
                <Loading>{isConnected ? "No query parameters provided." : "Connecting…"}</Loading>
            </AppShell>
        );
    }

    const { database, collection, query }: RenderData = renderData;

    return (
        <AppShell className="flex flex-col gap-4">
            <div>
                <Heading>
                    {database}.{collection}.
                    {isFindQuery(query) ? "find" : isAggregateQuery(query) ? "aggregate" : "query"}
                </Heading>
                <Code className="mt-0.5">
                    {isFindQuery(query)
                        ? JSON.stringify(query.find, null, 2)
                        : JSON.stringify(query.aggregate.pipeline, null, 2)}
                </Code>
            </div>

            <div>
                {status === "loading" && <Loading className="mt-0.5">Running query…</Loading>}
                {status === "done" && toolError && <ErrorText className="mt-0.5">{toolError}</ErrorText>}
                {status === "done" &&
                    result &&
                    (() => {
                        const sc = result.structuredContent as
                            | { documents?: unknown[]; totalCount?: number }
                            | undefined;
                        const docs = Array.isArray(sc?.documents) ? sc.documents : null;
                        if (docs) {
                            const bsonDocs = EJSON.deserialize(docs) as unknown[];
                            return (
                                <>
                                    <Label>
                                        Showing {bsonDocs.length > 0 ? 1 : 0} to {bsonDocs.length}
                                        {sc?.totalCount !== undefined &&
                                            ` of ${sc.totalCount} document${sc.totalCount !== 1 ? "s" : ""}`}
                                    </Label>
                                    <Code className="mt-0.5">
                                        {"[\n"}
                                        {bsonDocs.map((d, i) => (
                                            <React.Fragment key={i}>
                                                <TreeValue value={d} indent={1} />
                                                {i < bsonDocs.length - 1 ? ",\n" : ""}
                                            </React.Fragment>
                                        ))}
                                        {"\n]"}
                                    </Code>
                                </>
                            );
                        }
                        // TODO: Not sure about this. It is an error case, right?
                        return (
                            <>
                                <Label>Results</Label>
                                <Text className="mt-0.5">
                                    {result.content
                                        .filter(
                                            (c): c is { type: "text"; text: string } => c.type === "text" && "text" in c
                                        )
                                        .map((c) => c.text)
                                        .join("\n")}
                                </Text>
                            </>
                        );
                    })()}
            </div>
        </AppShell>
    );
};
