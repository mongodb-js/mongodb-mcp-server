import os from "os";

export type Platform = "mac" | "windows" | "linux";
export const getPlatform = (): Platform | null => {
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
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
