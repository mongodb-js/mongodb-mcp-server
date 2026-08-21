/** Returns `{ "x-request-id": "..." }` when the headers carry one, else `{}`. Spread inside a LogPayload's `attributes` field. */
export function requestIdAttr(headers: Record<string, unknown> | undefined): Record<string, string> {
    if (!headers) {
        return {};
    }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === "x-request-id");
    const id = key !== undefined ? headers[key] : undefined;
    return typeof id === "string" ? { "x-request-id": id } : {};
}
