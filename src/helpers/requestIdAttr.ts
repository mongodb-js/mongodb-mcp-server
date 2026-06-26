/** Returns `{ "x-request-id": "..." }` when the headers carry one, else `{}`. Spread inside a LogPayload's `attributes` field. */
export function requestIdAttr(headers: Record<string, unknown> | undefined): Record<string, string> {
    const id = headers?.["x-request-id"];
    return typeof id === "string" ? { "x-request-id": id } : {};
}
