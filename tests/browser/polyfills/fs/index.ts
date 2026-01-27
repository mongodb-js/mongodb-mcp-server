// Browser polyfill for Node.js fs module
// Minimal no-op implementation since file system operations aren't supported in browsers
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */

import type { Writable, Readable } from "stream";

export const promises = {
    stat: async (): Promise<never> => {
        throw new Error("fs operations are not supported in browser environment");
    },
    readFile: async (): Promise<never> => {
        throw new Error("fs operations are not supported in browser environment");
    },
    writeFile: async (): Promise<never> => {
        throw new Error("fs operations are not supported in browser environment");
    },
    mkdir: async (): Promise<never> => {
        throw new Error("fs operations are not supported in browser environment");
    },
    readdir: async (): Promise<never> => {
        throw new Error("fs operations are not supported in browser environment");
    },
};

export function createWriteStream(_path: string, _options?: unknown): Writable {
    throw new Error("fs operations are not supported in browser environment");
}

export function createReadStream(_path: string, _options?: unknown): Readable {
    throw new Error("fs operations are not supported in browser environment");
}

export function readFileSync(_path: string, _options?: unknown): string {
    throw new Error("fs operations are not supported in browser environment");
}

export function writeFileSync(_path: string, _data: unknown, _options?: unknown): void {
    throw new Error("fs operations are not supported in browser environment");
}

export function existsSync(_path: string): boolean {
    return false;
}

export function statSync(_path: string): unknown {
    throw new Error("fs operations are not supported in browser environment");
}

export function mkdirSync(_path: string, _options?: unknown): void {
    throw new Error("fs operations are not supported in browser environment");
}

export default {
    promises,
    createWriteStream,
    createReadStream,
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    mkdirSync,
};
