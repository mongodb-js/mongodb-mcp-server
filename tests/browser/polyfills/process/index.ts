// Browser polyfill for Node.js process module
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-argument */

export const env = {} as Record<string, string | undefined>;
export const version = "v24.0.0";
export const versions = {};
export const platform = "browser";
export const browser = true;
export const argv = [] as string[];
export const cwd = (): string => "/";
export const nextTick = (callback: (...args: any[]) => void, ...args: any[]): void => {
    Promise.resolve().then(() => callback(...args));
};

const processPolyfill = {
    env,
    version,
    versions,
    platform,
    browser,
    argv,
    cwd,
    nextTick,
};

// Set on globalThis for code that accesses global process
(globalThis as { process: any }).process = processPolyfill;

export default processPolyfill;
