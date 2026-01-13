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

    if (rest.length === 0) {
        safeDefineProperty(current, key, value);
        return;
    }

    const currentPath = parentPath ? `${parentPath}.${key}` : key;
    const hasOwnProperty = Object.prototype.hasOwnProperty.call(current, key);
    const existingValue = hasOwnProperty ? current[key] : undefined;

    if (existingValue === undefined || existingValue === null) {
        safeDefineProperty(current, key, {});
    } else if (typeof existingValue !== "object" || Array.isArray(existingValue)) {
        throw new Error(`Cannot set field at provided path: intermediate path '${currentPath}' is not an object.`);
    }

    _setFieldPath(current[key] as Record<string, unknown>, rest, value, currentPath);
}

// The provided field path might include some internal Object properties such as
// `__proto__`. For such paths, we need to ensure that we don't override the
// derived properties on the object so we explicitly set these properties as
// Object's own property.
function safeDefineProperty(obj: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(obj, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}
