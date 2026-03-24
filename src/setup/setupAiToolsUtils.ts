import os from "os";

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

export const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
