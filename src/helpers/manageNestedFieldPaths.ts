// Delete a specified field path from a document using dot notation.
export function deleteFieldPath(document: Record<string, unknown>, fieldPath: string): void {
    const parts = fieldPath.split(".");
    let current: Record<string, unknown> = document;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const key = part as keyof typeof current;
        if (!current[key]) {
            return;
        } else if (i === parts.length - 1) {
            delete current[key];
        } else {
            current = current[key] as Record<string, unknown>;
        }
    }
}

// Set a value at a specified field path in a document using dot notation.
// Throws an error if an intermediate path contains a non-object value.
export function setFieldPath(document: Record<string, unknown>, fieldPath: string, value: unknown): void {
    const parts = fieldPath.split(".");
    let current: Record<string, unknown> = document;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i] as keyof typeof current;
        if (current[part] === undefined || current[part] === null) {
            current[part] = {};
        } else if (typeof current[part] !== "object" || Array.isArray(current[part])) {
            const traversedPath = parts.slice(0, i + 1).join(".");
            throw new Error(
                `Cannot set field at path '${fieldPath}': intermediate path '${traversedPath}' is not an object.`
            );
        }
        current = current[part] as Record<string, unknown>;
    }
    const lastPart = parts[parts.length - 1] as string;
    current[lastPart] = value;
}
