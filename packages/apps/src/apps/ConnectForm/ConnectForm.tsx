import React, { useState, useEffect, type ReactElement } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { AppShell, Label, Input, Button, ErrorText, Success, Heading } from "../../components/elements.js";

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
            let result;
            try {
                result = await app.callServerTool({ name: "connect", arguments: { connectionString } });
            } catch (err) {
                // connect is disabled when already connected — swap to switch-connection
                if (err instanceof Error && err.message === "Tool connect disabled") {
                    result = await app.callServerTool({ name: "switch-connection", arguments: { connectionString } });
                } else {
                    throw err;
                }
            }
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
            <AppShell>
                <ErrorText>Failed to connect to MCP host: {hostError.message}</ErrorText>
            </AppShell>
        );
    }

    return (
        <AppShell>
            <Heading>Connect to MongoDB</Heading>
            {status === "success" ? (
                <Success>Connected successfully!</Success>
            ) : (
                <>
                    <form
                        onSubmit={(e) => {
                            void handleSubmit(e);
                        }}
                        className="flex w-full flex-col gap-2"
                    >
                        <Label htmlFor="connection-string">Connection String</Label>
                        <Input
                            id="connection-string"
                            type="text"
                            value={connectionString}
                            onChange={(e) => setConnectionString(e.target.value)}
                            placeholder="mongodb://localhost:27017"
                            required
                            disabled={!isConnected || status === "connecting"}
                        />
                        <Button type="submit" disabled={!isConnected || status === "connecting"}>
                            {status === "connecting" ? "Connecting…" : "Connect"}
                        </Button>
                    </form>
                    {status === "error" && errorMessage && <ErrorText className="mt-2">{errorMessage}</ErrorText>}
                </>
            )}
        </AppShell>
    );
};
