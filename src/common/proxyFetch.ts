import { createFetch } from "@mongodb-js/devtools-proxy-support";
import { isNodeRuntime } from "../helpers/isNodeRuntime.js";

let sharedProxyFetch: typeof fetch | undefined;

/**
 * Process-wide memoized `fetch`. In Node it is backed by
 * devtools-proxy-support's `createFetch` (env-var proxy config + system-CA
 * trust); elsewhere it falls back to the platform `fetch`.
 *
 * Memoized because `createFetch` builds a fresh multi-hundred-KB system-CA
 * string and a proxy Agent that accumulates over time with as many calls to
 * createFetch. Our current usage can safely utilize a shared fetch instance so
 * we memoize it.
 */
export function getSharedProxyFetch(): typeof fetch {
    if (sharedProxyFetch === undefined) {
        // In Node we use `createFetch` from devtools-proxy-support to pick up
        // environment-variable proxy configuration and system CA trust, and we
        // use node-fetch's Request since its interface is a superset of the web
        // Request. In the browser those Node-only concerns don't apply and the
        // implementations aren't available, so we fall back to the native
        // `fetch`/`Request` globals. createFetch assumes that the first
        // parameter of fetch is always a string with the URL. However, fetch
        // can also receive a Request object. While the typechecking complains,
        // createFetch does passthrough the parameters so it works fine. That
        // said, node-fetch has incompatibilities with the web version of fetch
        // and can lead to genuine issues so we would like to move away of
        // node-fetch dependency.
        sharedProxyFetch = isNodeRuntime()
            ? (createFetch({
                  useEnvironmentVariableProxies: true,
              }) as unknown as typeof fetch)
            : globalThis.fetch.bind(globalThis);
    }
    return sharedProxyFetch;
}
