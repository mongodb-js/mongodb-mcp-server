import { createFetch } from "@mongodb-js/devtools-proxy-support";

let sharedProxyFetch: typeof fetch | undefined;

/**
 * Node detection via `process.versions.node` (bundlers may shim `process`
 * to a plain object, so `typeof process` alone is not reliable).
 */
function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && process.versions !== undefined && process.versions.node !== undefined;
}

/**
 * Process-wide memoized `fetch`: `createFetch` (proxy + system CA) in Node,
 * platform `fetch` elsewhere. Memoized because `createFetch` builds a fresh
 * system-CA bundle and proxy Agent per call, which accumulates until OOM.
 */
export function getSharedProxyFetch(): typeof fetch {
    if (sharedProxyFetch === undefined) {
        sharedProxyFetch = isNodeRuntime()
            ? (createFetch({
                  useEnvironmentVariableProxies: true,
              }) as unknown as typeof fetch)
            : globalThis.fetch.bind(globalThis);
    }
    return sharedProxyFetch;
}

/** A matched `fetch`/`Request` pair (must come from the same implementation). */
export type HttpClient = {
    fetch: typeof fetch;
    Request: typeof globalThis.Request;
};

/** Default `httpClient`: the shared proxy-aware `fetch` + platform `Request`. */
export function getDefaultHttpClient(): HttpClient {
    return {
        fetch: getSharedProxyFetch(),
        Request: globalThis.Request,
    };
}
