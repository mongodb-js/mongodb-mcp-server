# Code Review Instructions

## Tool Response Consistency

When a tool returns both `content` (text array) and `structuredContent` (typed object), the two representations must contain the same details. Both are returned to the MCP client, which decides which one to forward to the LLM depending on its implementation. They may differ in formatting and representation, but the underlying information must be equivalent — no field should be present in one and missing from the other.

Tests should validate both the `content` and `structuredContent` responses and ensure they represent equivalent information.
