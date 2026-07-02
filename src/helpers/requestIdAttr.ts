/** Returns `{ "x-request-id": "..." }` when the headers carry one, else `{}`. Spread inside a LogPayload's `attributes` field. */
export function requestIdAttr(headers: Record<string, unknown> | undefined): Record<string, string> {
    if (!headers) {
        return {};
    }
    for (const key in headers) {
        if (key.toLowerCase() === "x-request-id") {
            const id = headers[key];
            return typeof id === "string" ? { "x-request-id": id } : {};
        }
    }
    return {};
}
