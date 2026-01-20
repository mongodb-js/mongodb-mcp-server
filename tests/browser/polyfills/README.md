### Polyfills

This directory contains polyfills for the browser environment. Most of the polyfills 1:1 match those in [compass-web](https://github.com/mongodb-js/compass/tree/main/packages/compass-web/polyfills) so they provide a way to ensure our integration can remain stable. Ideally, we would want to both reduce these polyfills and/or be more explicitly in sync with the polyfills used in compass-web and other target platforms.

We may also want to consider distributing a version of the library with those polyfills applied.

#### Adding polyfills

Ideally we want to avoid additional polyfills. There's a few approaches we can take:

In `vite.config.ts`, if we want to simply error if one attempts to import the polyfilled package we can use the `throwErrorPolyfill` function.

```
    kerberos: throwErrorPolyfill(),
```

If we want the polyfill to be a no-op, we can use the `emptyPolyfill` function.

```
    express: emptyPolyfill(),
```

For anything more custom, one should create a new file in this directory which matches the package name (for example `@mongodb-js/atlas-local` would be in `polyfills/@mongodb-js/atlas-local/index.ts`) and then use the `localPolyfill` function.

```
    "@mongodb-js/atlas-local": localPolyfill("@mongodb-js/atlas-local"),
```
