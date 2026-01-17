# Browser Tests

This directory contains end-to-end tests that run in **actual browsers** using Playwright to ensure that the web-compatible exports of the MongoDB MCP Server library can be embedded in a browser environment.

## Purpose

These tests verify that:
- The MCP server library can be embedded and run in a real browser environment
- No Node.js-specific code is executed (fs, path, process, etc.)
- Only browser-compatible APIs are used (Web Crypto, Web Streams, fetch, etc.) and we are not introducing new APIs we need to polyfill.
- The library works with default browser-safe settings

## Running Browser Tests

```bash
# From workspace root - install browser-tests and root
pnpm install --workspace browser-tests

# From this directory - run browser tests
cd tests/browser-tests
pnpm test --workspace browser-tests
```

## Adding New Browser Tests

When adding or fixing tests, ensure they:

1. **Don't rely on Node.js APIs**: No `require()`, `process`, `fs`, etc. In rare cases, we can add additional polyfills. Generally, we should instead focus on using browser-compatible APIs.
2. **Use Web APIs**: `fetch`, `crypto`, Web Streams, etc.
3. **Test real browser behavior**: Timers, events, storage APIs
4. **Verify no Node.js pollution**: Check that Node.js globals are undefined

## Running Tests Locally


Browser tests require Playwright to be installed:

```bash
# In CI environment
npm install -g playwright
playwright install chromium --with-deps
```

You might find it useful to run tests with headed mode (browser visible) to debug tests:
```bash
# Run with headed mode (browser visible)
HEADED=1 pnpm test:browser
```

