import React, { useState, type ReactElement } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";

export const ConnectForm = (): ReactElement => {
    const {
        app,
        isConnected,
        error: hostError,
    } = useApp({
        appInfo: { name: "connect-form", version: "1.0.0" },
        capabilities: {},
    });

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
        return <div>Failed to connect to MCP host: {hostError.message}</div>;
    }

    return (
        <div className="connect-form">
            <h2>Connect to MongoDB</h2>
            {status === "success" ? (
                <p className="success">Connected successfully!</p>
            ) : (
                <>
                    <form onSubmit={handleSubmit}>
                        <label htmlFor="connection-string">Connection String</label>
                        <input
                            id="connection-string"
                            type="text"
                            value={connectionString}
                            onChange={(e) => setConnectionString(e.target.value)}
                            placeholder="mongodb://localhost:27017"
                            required
                            disabled={!isConnected || status === "connecting"}
                        />
                        <button type="submit" disabled={!isConnected || status === "connecting"}>
                            {status === "connecting" ? "Connecting…" : "Connect"}
                        </button>
                    </form>
                    {status === "error" && errorMessage && <p className="error">{errorMessage}</p>}
                </>
            )}
        </div>
    );
};
