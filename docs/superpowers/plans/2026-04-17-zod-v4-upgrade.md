# Zod v4 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `zod` from `^3.25.76` to `^4.0.0` across the codebase.

**Architecture:** zod@4 is API-stable with v3 for the common cases used in this repo. The default `import { z } from "zod"` now gives v4. Two files already use `from "zod/v4"` — they just need their import path simplified. Only three files need actual code changes because two utility types were removed in v4 (`objectOutputType` and `AnyZodObject`). All 40+ tool files using `.passthrough()`, `.extend()`, `.safeParse()`, etc. work unchanged because zod@4 kept these APIs.

**Tech Stack:** TypeScript, zod@4, pnpm, vitest, `@modelcontextprotocol/sdk` (already supports `zod ^3.25 || ^4.0`).

---

## File Map

| File                                             | Change type                  | Reason                                                                                                                                                    |
| ------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                   | Modify: version bump         | Upgrade zod dep                                                                                                                                           |
| `src/common/config/userConfig.ts`                | Modify: import path + alias  | `from "zod/v4"` → `from "zod"`, `z4` → `z`                                                                                                                |
| `src/common/config/parseUserConfig.ts`           | Modify: import path + alias  | `from "zod/v4"` → `from "zod"`, `z4` → `z`                                                                                                                |
| `src/tools/tool.ts`                              | Modify: one type expression  | `z.objectOutputType` removed in v4                                                                                                                        |
| `src/tools/args.ts`                              | Modify: two type annotations | `z.AnyZodObject` removed in v4; `ZodEnum<[...]>` array form invalid                                                                                       |
| All other `src/**/*.ts` files using `from "zod"` | **No changes needed**        | v4 kept `.passthrough()`, `.extend()`, `ZodRawShape`, `ZodTypeAny` (alias), `ZodString`, `ZodDefault`, `z.preprocess`, `.safeParse`, `error.issues`, etc. |
| Test files                                       | **No changes needed**        | Same reasoning                                                                                                                                            |

---

## Risk: `@mongosh/arg-parser` compatibility

`@mongosh/arg-parser` depends on `zod@^3.25.76` and its own type defs already import from `zod/v4`. After our upgrade pnpm will give `@mongosh/arg-parser` its own separate zod@3 install (since v4 does not satisfy `^3.25.76`). This is safe because:

1. zod@3.25.x ships the v4 compat layer at `zod/v4`, so @mongosh's schemas are already v4-structured instances.
2. TypeScript resolves `zod/v4` in @mongosh's type defs against the hoisted zod@4 package in our workspace, so types align.

If TypeScript reports module-identity mismatches after the upgrade, the fix is to add a `pnpm.overrides` entry in `package.json` forcing all packages to use `zod@^4`:

```json
"pnpm": {
  "overrides": {
    "zod": "^4.0.0"
  }
}
```

This would force @mongosh to share our zod@4 install. Only do this if type errors appear.

---

## Task 1: Bump zod in package.json and install

**Files:**

- Modify: `package.json` (line ~185)

- [ ] **Step 1: Update the version**

In `package.json`, change:

```json
"zod": "^3.25.76"
```

to:

```json
"zod": "^4.0.0"
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: pnpm resolves zod@4.x, lockfile updated. `@mongosh/arg-parser` may get its own zod@3 nested install — that is expected.

- [ ] **Step 3: Quick sanity check**

```bash
node -e "const z = require('./node_modules/zod'); console.log(z.z?.string ? 'v4 named' : z.string ? 'v4 default' : 'unknown')"
```

Expected: output confirms v4 is installed.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: bump zod to ^4.0.0"
```

---

## Task 2: Fix removed type `objectOutputType` in `src/tools/tool.ts`

**Files:**

- Modify: `src/tools/tool.ts:41`

`z.objectOutputType<T, U>` was removed in zod v4. It mapped a `ZodRawShape` to its output type. The direct v4 equivalent is `z.infer<z.ZodObject<T>>`.

**Before (line 1 and lines 38–42):**

```typescript
import type { z, ZodRawShape, ZodTypeAny } from "zod";
// ...
type StructuredToolResult<OutputSchema extends ZodRawShape> = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent: z.objectOutputType<OutputSchema, ZodTypeAny>;
};
```

`ZodTypeAny` is still exported from zod@4 as a compat alias for `ZodType`, so that import stays.

- [ ] **Step 1: Write a failing typecheck before the fix**

```bash
pnpm run check:types 2>&1 | grep "objectOutputType"
```

Expected: error mentioning `objectOutputType` does not exist.

- [ ] **Step 2: Apply the fix**

In `src/tools/tool.ts`, change line 41:

```typescript
structuredContent: z.objectOutputType<OutputSchema, ZodTypeAny>;
```

to:

```typescript
structuredContent: z.infer<z.ZodObject<OutputSchema>>;
```

The `ZodTypeAny` import on line 1 can now be removed since it's no longer used:

```typescript
import type { z, ZodRawShape } from "zod";
```

- [ ] **Step 3: Run typecheck to verify the fix**

```bash
pnpm run check:types 2>&1 | grep -E "tool\.ts|error TS"
```

Expected: no errors from `tool.ts` related to `objectOutputType`.

- [ ] **Step 4: Commit**

```bash
git add src/tools/tool.ts
git commit -m "fix: replace removed z.objectOutputType with z.infer<z.ZodObject<T>> for zod v4"
```

---

## Task 3: Fix removed types in `src/tools/args.ts`

**Files:**

- Modify: `src/tools/args.ts:1`, `args.ts:45`, `args.ts:85–86`

Two problems:

1. `z.AnyZodObject` was removed in v4. `zEJSON()` uses it as a return type. The correct v4 replacement is `z.ZodTypeAny` (which maps to `ZodType` in v4 and is still exported).
2. `z.ZodDefault<z.ZodEnum<["standard", "private", "privateEndpoint"]>>` — in v4 `ZodEnum<T>` no longer accepts a tuple as `T`; only `EnumLike` (object) form is valid. Simplest fix: remove the explicit return type annotation and let TypeScript infer.

- [ ] **Step 1: Confirm the errors**

```bash
pnpm run check:types 2>&1 | grep "args\.ts"
```

Expected: errors about `AnyZodObject` not existing and invalid type argument for `ZodEnum`.

- [ ] **Step 2: Fix the import on line 1**

Current:

```typescript
import { z, type ZodString } from "zod";
```

No change needed here — `ZodString` still exists in v4.

- [ ] **Step 3: Fix `zEJSON()` return type (line 85–86)**

Change:

```typescript
export function zEJSON(): z.AnyZodObject {
  return z
    .object({})
    .passthrough()
    .transform(toEJSON) as unknown as z.AnyZodObject;
}
```

to:

```typescript
export function zEJSON(): z.ZodTypeAny {
  return z
    .object({})
    .passthrough()
    .transform(toEJSON) as unknown as z.ZodTypeAny;
}
```

`z.ZodTypeAny` is the v4 compat alias for `ZodType<any>` and satisfies `ZodRawShape` value requirements.

- [ ] **Step 4: Fix `connectionType` return type annotation (line 45)**

Change:

```typescript
    connectionType: (): z.ZodDefault<z.ZodEnum<["standard", "private", "privateEndpoint"]>> =>
        z.enum(["standard", "private", "privateEndpoint"]).default("standard"),
```

to (remove the return type annotation):

```typescript
    connectionType: () =>
        z.enum(["standard", "private", "privateEndpoint"]).default("standard"),
```

TypeScript infers the correct type from the expression; the annotation was redundant.

- [ ] **Step 5: Run typecheck to verify**

```bash
pnpm run check:types 2>&1 | grep "args\.ts"
```

Expected: no errors from `args.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/tools/args.ts
git commit -m "fix: replace removed z.AnyZodObject with z.ZodTypeAny for zod v4"
```

---

## Task 4: Simplify config file imports (zod/v4 → zod)

**Files:**

- Modify: `src/common/config/userConfig.ts:1`
- Modify: `src/common/config/parseUserConfig.ts:11`

These two files already use the v4 API via `from "zod/v4"` and the `z4` alias. Now that we're on zod@4, `from "zod"` IS v4, so we can clean up the alias.

### userConfig.ts

- [ ] **Step 1: Update the import**

Change line 1:

```typescript
import { z as z4 } from "zod/v4";
```

to:

```typescript
import { z } from "zod";
```

- [ ] **Step 2: Replace the `z4` alias throughout the file**

Replace all occurrences of `z4.` with `z.` and `z4.infer` with `z.infer`. The file uses `z4` in ~50 places. Use a global find-replace. Verify with:

```bash
grep -n "z4\." src/common/config/userConfig.ts
```

Expected: zero matches.

Also update the `configRegistry` line:

```typescript
export const configRegistry = z4.registry<ConfigFieldMeta>();
```

becomes:

```typescript
export const configRegistry = z.registry<ConfigFieldMeta>();
```

And:

```typescript
export type UserConfig = z4.infer<typeof UserConfigSchema>;
```

becomes:

```typescript
export type UserConfig = z.infer<typeof UserConfigSchema>;
```

### parseUserConfig.ts

- [ ] **Step 3: Update the import**

Change line 11:

```typescript
import { z as z4 } from "zod/v4";
```

to:

```typescript
import { z } from "zod";
```

- [ ] **Step 4: Replace the `z4` alias throughout the file**

Replace all occurrences of `z4.` with `z.`. There are ~6 places. Verify:

```bash
grep -n "z4\." src/common/config/parseUserConfig.ts
```

Expected: zero matches.

Also update type annotations:

```typescript
overrides?: z4.ZodRawShape;
```

becomes:

```typescript
overrides?: z.ZodRawShape;
```

And:

```typescript
parsed: Partial<CliOptions & z4.infer<T>>;
let parsed: Partial<CliOptions & z4.infer<T>>;
```

become:

```typescript
parsed: Partial<CliOptions & z.infer<T>>;
let parsed: Partial<CliOptions & z.infer<T>>;
```

- [ ] **Step 5: Run typecheck on config files**

```bash
pnpm run check:types 2>&1 | grep -E "userConfig|parseUserConfig"
```

Expected: no type errors in these files.

- [ ] **Step 6: Commit**

```bash
git add src/common/config/userConfig.ts src/common/config/parseUserConfig.ts
git commit -m "chore: simplify zod import from zod/v4 to zod now that zod@4 is installed"
```

---

## Task 5: Full typecheck and build verification

- [ ] **Step 1: Run full typecheck**

```bash
pnpm run check:types 2>&1 | grep -E "error TS" | head -30
```

Expected: zero errors. If there are errors from `@mongosh/arg-parser` type mismatches, see the **Risk** section above and add a `pnpm.overrides` block to `package.json`.

If you see errors of the form:

```
Type 'import(".../zod/v4/classic/...").ZodObject<...>' is not assignable to type 'import(".../zod/...").ZodObject<...>'
```

This is the module-identity mismatch from `@mongosh/arg-parser` having its own zod@3. Fix by adding to `package.json`:

```json
"pnpm": {
  "overrides": {
    "zod": "^4.0.0"
  }
}
```

Then re-run `pnpm install` and re-run `pnpm run check:types`.

- [ ] **Step 2: Full build**

```bash
pnpm run build 2>&1 | tail -20
```

Expected: build completes without errors.

- [ ] **Step 3: Commit any `pnpm.overrides` changes if needed**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: force zod@4 for all packages via pnpm overrides"
```

(Only create this commit if you had to add the overrides.)

---

## Task 6: Run the test suite

- [ ] **Step 1: Run unit + integration tests**

```bash
pnpm test 2>&1 | tail -40
```

Expected: all tests pass (or same tests pass as before the upgrade; no regressions introduced by this change).

- [ ] **Step 2: If any test fails, diagnose**

Zod v4 parsing behavior changes to watch for:

- `z.preprocess()`: still works, but error path changed — if a preprocessor throws, the error message format may differ slightly.
- `error.issues[N].message`: same structure in v4.
- `.safeParse()` return: same `{ success, data, error }` shape.
- `z.coerce.*`: same behavior.

Check if failing tests do string matching on zod error messages — those may need updating to match v4's slightly different phrasing.

- [ ] **Step 3: Commit test fixes if needed**

```bash
git add <changed test files>
git commit -m "fix(tests): update zod error message expectations for v4"
```

---

## Self-Review Checklist

- [x] **`z.objectOutputType` removal** — covered in Task 2
- [x] **`z.AnyZodObject` removal** — covered in Task 3
- [x] **`z.ZodEnum<[...]>` array form** — covered in Task 3
- [x] **`from "zod/v4"` imports** — covered in Task 4
- [x] **`.passthrough()` usage** — NOT a breaking change in v4 (kept as alias for `.loose()`); no task needed
- [x] **`.merge()` usage** — not used on zod schemas in this codebase; no task needed
- [x] **`ZodTypeAny` import** — still exported from v4 as a compat alias; no task needed
- [x] **`ZodRawShape` import** — still exported from v4; no task needed
- [x] **`ZodString`, `ZodDefault` type references** — still exported from v4; no task needed
- [x] **`error.issues` usage in parseUserConfig** — same in v4; no task needed
- [x] **`@mongosh/arg-parser` compatibility** — documented as a risk in Task 5
- [x] **Test files** — covered in Task 6; no code changes expected
