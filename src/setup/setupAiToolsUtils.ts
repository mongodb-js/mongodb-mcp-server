import os from "os";
import { Keychain } from "../common/keychain.js";
import { redact } from "mongodb-redact";

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

export const formatError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return redact(message, Keychain.root.allSecrets);
};
