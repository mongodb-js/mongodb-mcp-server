# Browser Tests

This directory contains end-to-end tests that run in **actual browsers** using Playwright to ensure the MongoDB MCP Server library is fully browser-compatible.

## Purpose

These tests verify that:
- The MCP server library can be embedded and run in a real browser environment
- No Node.js-specific code is executed (fs, path, process, etc.)
- Only browser-compatible APIs are used (Web Crypto, Web Streams, fetch, etc.)
- The library works with default browser-safe settings

## Running Browser Tests

```bash
# From workspace root - install browser-tests and root
pnpm install --workspace browser-tests

# From this directory - run browser tests
cd tests/browser-tests
pnpm test --workspace browser-tests
```

## Test Environment

- **Test Runner**: Vitest with `@vitest/browser`
- **Browser**: Chromium (via Playwright)
- **Mode**: Headless by default
- **Timeout**: 60 seconds per test

## Key Differences from Node.js Tests

| Feature | Node.js | Browser |
|---------|---------|---------|
| File System | `fs`, `path` modules | ❌ Not available |
| Process | `process.env`, `process.cwd()` | ❌ Not available |
| Crypto | `crypto` module | ✅ Web Crypto API |
| Streams | Node.js Streams | ✅ Web Streams API |
| HTTP | `http`, `https` modules | ✅ `fetch` API |
| Modules | `require()`, `__dirname` | ❌ Not available |
| UUID | `crypto.randomUUID()` or uuid package | ✅ `crypto.randomUUID()` |
| Storage | File system | ✅ localStorage, IndexedDB |

## Adding New Browser Tests

When adding tests, ensure they:

1. **Don't rely on Node.js APIs**: No `require()`, `process`, `fs`, etc.
2. **Use Web APIs**: `fetch`, `crypto`, Web Streams, etc.
3. **Test real browser behavior**: Timers, events, storage APIs
4. **Verify no Node.js pollution**: Check that Node.js globals are undefined
5. **Use browser-safe configurations**: Readonly mode, no file operations

## Configuration

Browser test configuration is in `vitest.config.ts`:

```typescript
{
  test: {
    name: "browser",
    include: ["tests/browser/**/*.test.ts"],
    browser: {
      enabled: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
      provider: "playwright",
      headless: true,
    },
    testTimeout: 60000,
  },
}
```

## Debugging

To debug tests with browser DevTools:

```bash
# Run with headed mode (browser visible)
HEADED=1 pnpm test:browser

# Or modify vitest.config.ts temporarily:
# headless: false
```

## CI/CD Considerations

Browser tests require Playwright to be installed:

```bash
# In CI environment
npm install -g playwright
playwright install chromium --with-deps
```

