import React, { useState, useEffect, type ReactElement } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

export const ConnectForm = (): ReactElement => {
    const {
        app,
        isConnected,
        error: hostError,
    } = useApp({
        appInfo: { name: "connect-form", version: "1.0.0" },
        capabilities: {},
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

    const [connectionString, setConnectionString] = useState("mongodb://localhost:27017");
    const [status, setStatus] = useState<"idle" | "connecting" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();
        if (!app) return;

        setStatus("connecting");
        setErrorMessage(null);

        try {
            const result = await app.callServerTool({ name: "connect", arguments: { connectionString } });
            if (result.isError) {
                const text = result.content.find((c) => c.type === "text");
                setStatus("error");
                setErrorMessage(text && "text" in text ? text.text : "Connection failed");
            } else {
                setStatus("success");
            }
        } catch (err) {
            setStatus("error");
            setErrorMessage(err instanceof Error ? err.message : "Connection failed");
        }
    };

    if (hostError) {
        return (
            <div className="p-4 text-sm text-[var(--color-text-danger)]">
                Failed to connect to MCP host: {hostError.message}
            </div>
        );
    }

    return (
        <div className="p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">Connect to MongoDB</h2>
            {status === "success" ? (
                <p className="flex items-center gap-2 text-sm text-[var(--color-text-success)]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-success)]" />
                    Connected successfully!
                </p>
            ) : (
                <>
                    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2">
                        <label
                            htmlFor="connection-string"
                            className="text-xs font-medium text-[var(--color-text-secondary)]"
                        >
                            Connection String
                        </label>
                        <input
                            id="connection-string"
                            type="text"
                            value={connectionString}
                            onChange={(e) => setConnectionString(e.target.value)}
                            placeholder="mongodb://localhost:27017"
                            required
                            disabled={!isConnected || status === "connecting"}
                            className="w-full rounded-[var(--border-radius-md)] border border-[var(--color-border-primary)] bg-[var(--color-background-secondary)] px-3 py-1.5 font-mono text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-sm)] outline-none focus:ring-1 focus:ring-[var(--color-ring-primary)] disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={!isConnected || status === "connecting"}
                            className="cursor-pointer self-start rounded-[var(--border-radius-md)] bg-[var(--color-background-inverse)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-sm)] outline-none hover:bg-[var(--color-background-inverse-hover)] active:opacity-80 focus:ring-1 focus:ring-[var(--color-ring-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {status === "connecting" ? "Connecting…" : "Connect"}
                        </button>
                    </form>
                    {status === "error" && errorMessage && (
                        <p className="mt-2 text-xs text-[var(--color-text-danger)]">{errorMessage}</p>
                    )}
                </>
            )}
        </div>
    );
};
