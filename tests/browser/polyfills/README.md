### Polyfills

This directory contains polyfills for the browser environment. Most of the polyfills 1:1 match those in [compass-web](https://github.com/mongodb-js/compass/tree/main/packages/compass-web/polyfills) so they provide a way to ensure our integration can remain stable. Ideally, we would want to both reduce these polyfilsl and/or be more explicitly in sync with the polyfills used in compass-web and other target platforms.

We may also want to consider distributing a version of the library with those polyfills applied.
