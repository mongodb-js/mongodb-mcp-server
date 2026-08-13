# Code Review Instructions

## Tool Response Consistency

When a tool returns both `content` (text array) and `structuredContent` (typed object), the two representations must contain the same details. Both are returned to the MCP client, which decides which one to forward to the LLM depending on its implementation. They may differ in formatting and representation, but the underlying information must be equivalent — no field should be present in one and missing from the other.

Tests should validate both the `content` and `structuredContent` responses and ensure they represent equivalent information.

## Shared Tool Schemas

Tool input/output schemas are built once per tool class and variant, then shared across every session. If a tool's `argsShape` (or `outputSchema`) depends on runtime values — session state, config, or anything resolved per instance — it must override `schemaVariantKey()` to return a distinct key for each shape it can produce. Otherwise the first-built schema is cached and served to later sessions, freezing the wrong variant.

This applies to accessor-based (`get argsShape()`) and `register()`-time mutated shapes alike (see `CreateAccessListTool` and `MongoDBToolBase`). Flag any runtime-dependent `argsShape`/`outputSchema` that does not have a matching `schemaVariantKey()` override.
