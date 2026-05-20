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
# Install workspace dependencies
pnpm install
# Install the Playwright Chromium browser
pnpm --filter browser run install:browser
# Run the browser tests
pnpm --filter browser run test
```

You might find it useful to run tests with headed mode (browser visible) to debug tests:

```bash
# Run with headed mode (browser visible)
HEADED=1 pnpm --filter browser run test
```
