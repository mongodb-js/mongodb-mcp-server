// Stub for `os-dns-native`, which loads a native `.node` addon via `bindings`
// (unbundlable by esbuild). `@mongodb-js/devtools-connect` reads
// `osDns.withNodeFallback.resolveSrv` while resolving `mongodb+srv://` SRV
// records; without this the symbol is undefined and connection fails. Back the
// whole surface with Node's built-in `dns` so SRV resolution still works.
const dns = require("dns");

const passthrough = {
    resolve: (...args) => dns.resolve(...args),
    resolve4: (...args) => dns.resolve4(...args),
    resolve6: (...args) => dns.resolve6(...args),
    resolveCname: (...args) => dns.resolveCname(...args),
    resolveSrv: (...args) => dns.resolveSrv(...args),
    resolveTxt: (...args) => dns.resolveTxt(...args),
    promises: { ...dns.promises },
};

module.exports = {
    ...passthrough,
    withNodeFallback: passthrough,
    wasNativelyLookedUp: () => false,
};
