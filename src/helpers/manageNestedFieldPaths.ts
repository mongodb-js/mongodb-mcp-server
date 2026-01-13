const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Set a value at a specified field path in a document using dot notation.
// Throws an error if an intermediate path contains a non-object value or a blocked key is used.
export function setFieldPath(document: Record<string, unknown>, fieldPath: string, value: unknown): void {
    const parts = fieldPath.split(".");
    _setFieldPath(document, parts, value, "");
}

function _setFieldPath(current: Record<string, unknown>, parts: string[], value: unknown, parentPath: string): void {
    if (parts.length === 0) {
        return;
    }

    const [key, ...rest] = parts;
    if (!key) {
        return;
    }

    if (BLOCKED_KEYS.has(key)) {
        throw new Error(`Cannot set field at provided path: path segment '${key}' is not allowed.`);
    }

    if (rest.length === 0) {
        current[key] = value;
        return;
    }

    const currentPath = parentPath ? `${parentPath}.${key}` : key;

    if (current[key] === undefined || current[key] === null) {
        current[key] = {};
    } else if (typeof current[key] !== "object" || Array.isArray(current[key])) {
        throw new Error(`Cannot set field at provided path: intermediate path '${currentPath}' is not an object.`);
    }

    _setFieldPath(current[key] as Record<string, unknown>, rest, value, currentPath);
}
