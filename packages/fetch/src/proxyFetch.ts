import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { Request as NodeFetchRequest } from "node-fetch";

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

/**
 * A matched `fetch`/`Request` pair. Both must come from the same implementation:
 * a `Request` built by one implementation is not recognized as a `Request` by
 * another and gets coerced to a string, producing a bogus URL.
 */
export type HttpClient = {
    fetch: typeof fetch;
    Request: typeof globalThis.Request;
};

/**
 * The `HttpClient` used when an embedder doesn't provide one: the shared
 * proxy-aware `fetch` paired with the `Request` implementation it understands.
 */
export function getDefaultHttpClient(): HttpClient {
    return {
        fetch: getSharedProxyFetch(),
        // The proxy fetch delegates to node-fetch, so pair it with node-fetch's Request here.
        Request: (isNodeRuntime() ? NodeFetchRequest : globalThis.Request) as unknown as typeof globalThis.Request,
    };
}
