/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Browser polyfill for Node.js fs/promises module
// Minimal no-op implementation since file system operations aren't supported in browsers

export const stat = async () => {
    throw new Error("fs operations are not supported in browser environment");
};

export const readFile = async () => {
    throw new Error("fs operations are not supported in browser environment");
};

export const writeFile = async () => {
    throw new Error("fs operations are not supported in browser environment");
};

export const mkdir = async () => {
    throw new Error("fs operations are not supported in browser environment");
};

export const readdir = async () => {
    throw new Error("fs operations are not supported in browser environment");
};

export default {
    stat,
    readFile,
    writeFile,
    mkdir,
    readdir,
};
