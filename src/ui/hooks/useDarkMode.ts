import { useSyncExternalStore } from "react";

function subscribeToPrefersColorScheme(callback: () => void): () => void {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
}

function getPrefersDarkMode(): boolean {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useDarkMode(override?: boolean): boolean {
    const prefersDarkMode = useSyncExternalStore(subscribeToPrefersColorScheme, getPrefersDarkMode);
    return override ?? prefersDarkMode;
}
