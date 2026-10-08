# Code Review Instructions

## Tool Response Consistency

When a tool returns both `content` (text array) and `structuredContent` (typed object), the two representations must contain the same details. Both are returned to the MCP client, which decides which one to forward to the LLM depending on its implementation. They may differ in formatting and representation, but the underlying information must be equivalent — no field should be present in one and missing from the other.

Tests should validate both the `content` and `structuredContent` responses and ensure they represent equivalent information.

## Static Tool Schemas

`argsShape()` and `outputSchema()` are methods, not fields, and each must return a stable, module-level object (defined outside the class) rather than building a fresh object per call — instantiating a tool must not recreate its schema's object graph. If a tool's shape depends on runtime values (session state, config, or anything resolved per instance — e.g. `CreateAccessListTool`'s IP-lookup support, or `MongoDBToolBase`'s connectionId description), define every possible variant as its own static, module-level object (reusing shared sub-fields across variants wherever possible) and have `argsShape()`/`outputSchema()` select the right one at call time based on `this.server`/instance state. Flag any `argsShape()`/`outputSchema()` implementation that constructs or spreads into a new object inside the method body instead of returning a reference to a pre-built module-level constant.
