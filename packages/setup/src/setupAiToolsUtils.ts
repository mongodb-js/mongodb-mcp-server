import os from "os";
import { Keychain } from "@mongodb-js/mcp-core";
import type { IRedactor } from "@mongodb-js/mcp-types";

export type Platform = "mac" | "windows" | "linux";
export const getPlatform = (): Platform | null => {
    switch (os.platform()) {
        case "win32":
            return "windows";
        case "darwin":
            return "mac";
        case "linux":
            return "linux";
        default:
            return null;
    }
};

export const formatError = (error: unknown, redactor?: IRedactor): string => {
    const message = error instanceof Error ? error.message : String(error);
    // Redact with the caller's keychain when provided; otherwise an empty
    // keychain still applies the built-in mongodb-redact patterns (e.g. the
    // `mongodb://...` URI pattern), so credential-bearing URIs are scrubbed.
    return (redactor ?? new Keychain()).redact(message);
};
