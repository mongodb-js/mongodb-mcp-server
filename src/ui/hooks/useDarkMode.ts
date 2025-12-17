import { useSyncExternalStore } from "react";

function subscribeToPrefersColorScheme(callback: () => void): () => void {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
}

function getPrefersDarkMode(): boolean {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerSnapshot(): boolean {
    return false;
}

export function useDarkMode(override?: boolean): boolean {
    const prefersDarkMode = useSyncExternalStore(subscribeToPrefersColorScheme, getPrefersDarkMode, getServerSnapshot);
    return override ?? prefersDarkMode;
}
